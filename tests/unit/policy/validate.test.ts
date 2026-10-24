import { describe, it, expect } from "vitest";
import { validateSummary, validateOptimizerText } from "@/lib/domain/policy/validate";

const clean =
  "This week you spent $420.00 across your accounts and received $4,120.00 in income. Three transactions need your review.";

describe("policy validate — prohibited language", () => {
  it("passes calm, factual language", () => {
    const r = validateSummary(clean, { requiresStaleCaveat: false });
    expect(r.status).toBe("PASSED");
    expect(r.violations).toHaveLength(0);
  });

  it("blocks investment/advice recommendations", () => {
    const r = validateSummary("You should invest in an index fund and pay off your loan.", { requiresStaleCaveat: false });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it("blocks explicit recommendation phrasing", () => {
    expect(validateSummary("We recommend you refinance your mortgage.", { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it("blocks money-movement directives", () => {
    expect(validateSummary("Transfer money from savings to cover this.", { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it.each([
    "we re\u200Bcommend moving money today",
    "Transfer\u00a0money from savings to cover this.",
    "Transfer   money from savings to cover this.",
    "Transfer\n\tmoney from savings to cover this.",
    "WE ReCoMmEnD you lower spending.",
  ])("blocks advice evasion with normalized text: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it.each([
    "Consider reducing dining spending next week.",
    "Try setting a lower grocery budget.",
    "You should limit entertainment expenses this month.",
    "Aim to increase saving after payday.",
    "Focus on cutting subscription spending.",
    "Prioritize setting a smaller dining budget.",
    "Make sure to reduce expenses before Friday.",
    "Don't forget to lower spending next week.",
  ])("blocks prescriptive money coaching: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it.each([
    "This period you spent $420.00 across your accounts.",
    "Dining spending was $80.00 higher than the prior period.",
    "The grocery budget category had $210.00 in expenses.",
    "You received $4,120.00 in income.",
  ])("passes factual money language: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("PASSED");
  });

  it.each([
    "That was irresponsible spending.",
    "This pattern looks reckless.",
    "Those purchases were careless and wasteful.",
    "You failed at managing this week.",
    "You are bad with money.",
    "Here is a roast of your spending.",
  ])("blocks shaming or judgmental tone: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });
});

describe("policy validate — stale-data caveat", () => {
  it("requires a stale caveat when data is stale", () => {
    const r = validateSummary(clean, { requiresStaleCaveat: true });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.violations.some((v) => v.code === "missing_stale_caveat")).toBe(true);
  });

  it("passes when the stale caveat is present", () => {
    const withCaveat = `${clean} Note: some figures may be out of date because an account has stale data.`;
    expect(validateSummary(withCaveat, { requiresStaleCaveat: true }).status).toBe("PASSED");
  });

  it("prohibited language outranks a missing caveat (stays BLOCKED)", () => {
    const r = validateSummary("You should invest now.", { requiresStaleCaveat: true });
    expect(r.status).toBe("BLOCKED");
  });
});

describe("policy validate — docs/26 deny-list coverage", () => {
  it.each([
    "As your financial advisor, here is what to do.",
    "This is an AI financial planner recommendation.",
    "Here is personalized financial advice for you.",
    "This is our credit recommendation for the month.",
    "This plan offers guaranteed savings.",
    "This will save you $200 next month.",
    "It's a risk-free way to grow your money.",
    "The best credit card for you is this one.",
    "Consider the optimal allocation across funds.",
    "We suggest debt settlement to clear this.",
  ])("blocks docs/26 banned language a general summary previously slipped: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it.each([
    "This was your best savings month so far.",
    "Your account balance is the lowest it has been this year.",
    "You saved $200 more than last month.",
    "Your dining category had the highest spending this period.",
  ])("still passes factual superlatives and past-tense reporting: %s", (text) => {
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("PASSED");
  });
});

describe("policy validate — debt-priority ordering about a named credit product (no literal 'debt' required)", () => {
  // The gap this closes: existing patterns only caught "pay off your card/loan/
  // debt/balance" (requires the word "off") or "debt settlement/strategy/
  // prioritization" (requires the literal word "debt"). None of them caught an
  // ordering instruction that names a specific card directly, with no "off" and
  // no "debt" anywhere in the sentence.
  it.each([
    "Pay the Visa card first.",
    "Prioritize the Chase card over the Amex balance.",
    "You can pay your Discover card first if you choose this scenario.",
    "Pay the mortgage before the car loan this month.",
    "Pay the Citibank card ahead of the Mastercard.",
  ])("blocks ordering advice naming a credit product directly: %s", (text) => {
    const r = validateSummary(text, { requiresStaleCaveat: false });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "debt_priority_ordering")).toBe(true);
  });

  it("still passes a factual statement about the user's own account terms", () => {
    const r = validateSummary("Your Visa APR is 24.99%, based on your account terms.", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("PASSED");
  });

  it("still passes past-tense reporting of what already happened (no 'pay'/'prioritize' verb)", () => {
    const r = validateSummary("The Visa card was paid before the Amex last month.", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("PASSED");
  });

  it("still passes legitimate ranking language that never says 'pay' or 'prioritize'", () => {
    const r = validateSummary("The Chase card renegotiation ranked first by estimated savings.", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("PASSED");
  });
});

describe("validateOptimizerText — the exact audited gap case, and the conditional-factual allowlist", () => {
  it("blocks the audited case: a named card, ordering language, and a trailing unrelated hedge", () => {
    // This is the literal finding: naming a specific card directly with ordering
    // language ("first") was not caught at all, and CONDITIONAL_FACTUAL_ALLOWLIST
    // was satisfied merely because the unrelated word "about" appeared later in
    // the text (in a different sentence, hedging a different, unrelated figure).
    const r = validateOptimizerText("Pay the Visa card first. About $50/month is listed [ev_123].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "debt_priority_ordering")).toBe(true);
  });

  it.each([
    "Prioritize the Chase card over the Amex balance this month [ev_1].",
    "Pay the Discover card before the student loan if you want to save on interest [ev_1].",
  ])("blocks other debt-priority ordering phrasings: %s", (text) => {
    expect(validateOptimizerText(text, { requiresStaleCaveat: false }).status).toBe("BLOCKED");
  });

  it("still passes legitimate ranking of the user's OWN optimizer opportunities", () => {
    const r = validateOptimizerText(
      "The Chase card renegotiation ranks first because its estimated saving is about $40.00 per month [ev_1].",
      { requiresStaleCaveat: false },
    );
    expect(r.status).toBe("PASSED");
  });

  it("the allowlist no longer accepts a bare, number-less 'about' as sufficient hedging", () => {
    // No digit anywhere near "about", and no "if"/"estimated"/"scenario"/etc.
    // either — this must now fail the conditional-factual requirement, where
    // before the bare word "about" alone satisfied the allowlist.
    const r = validateOptimizerText("Thinking about the Chase card renewal timing [ev_1].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "not_conditional_factual")).toBe(true);
  });

  it("the allowlist still accepts 'about' when it actually hedges a figure", () => {
    const r = validateOptimizerText("Cancelling the subscription saves about $12.00 per month [ev_1].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("PASSED");
  });
});
