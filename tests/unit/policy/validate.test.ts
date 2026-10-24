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
    // Codex independent review (money-core PR #23) found these three gaps in
    // the first draft and they are fixed here, not just narrated:
    "Settle the Visa first.", // verb coverage: "settle" a card, not just "pay"
    "Paying the Visa first saves interest.", // the "-ing" form of "pay" itself
    "Pay off the Visa first.", // "off" as ordinary filler, not required
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

  /*
   * Codex independent review (money-core PR #23) found two real false-positive
   * risks in the first draft, both fixed here:
   *
   *   1. "before"/"over"/"above"/"ahead of" are relational words that make
   *      sense against almost anything, not just another credit product —
   *      "pay the Visa before its due date" is a plain statement of a
   *      payment's timing, not an instruction to prioritize one product over
   *      another. The pattern now requires a SECOND named product after
   *      before/over/above/ahead-of (not after "first", which is risky
   *      regardless of what — if anything — follows it).
   *   2. The filler between verb/product/ordering-word was word-count-bounded
   *      but NOT sentence-bounded, so it could cross a period into a
   *      completely unrelated sentence. Fixed with a character-class filler
   *      that excludes `.?!` outright, matching this file's OWN "same
   *      sentence" convention elsewhere (see assistant-guardrails.ts in
   *      money-manager for the identical technique on a different pattern).
   */
  it.each([
    "You pay your Visa before its due date.",
    "Your pay reached the Chase account. First, here is the estimated total.",
  ])("still passes legitimate copy a looser ordering pattern would have falsely blocked: %s", (text) => {
    const r = validateSummary(text, { requiresStaleCaveat: false });
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
    // NOTE (Codex independent review, money-core PR #23): "Prioritize..." is
    // ALSO independently blocked by OPTIMIZER_BLOCKS's own pre-existing
    // `directive_verb` pattern (bare "prioritize"), so that fixture alone
    // does not isolate THIS pattern's contribution — it is kept as a
    // defense-in-depth demonstration (both layers agree), and the "pay"
    // fixture below is the one that isolates `debt_priority_ordering`
    // cleanly: it trips no other existing pattern in either list.
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
    // No dollar figure anywhere near "about", and no "if"/"estimated"/
    // "scenario"/etc. either — this must now fail the conditional-factual
    // requirement, where before the bare word "about" alone satisfied the
    // allowlist.
    const r = validateOptimizerText("Thinking about the Chase card renewal timing [ev_1].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "not_conditional_factual")).toBe(true);
  });

  it("the allowlist no longer accepts a bare NUMBER near 'about' either (Codex independent review)", () => {
    // Money-core PR #23's first draft required only a bare digit near
    // "about", which "Thinking about 2 renewal dates" would have satisfied —
    // a digit with no dollar sign is not a hedged financial figure. Tightened
    // to require a dollar amount specifically, matching the actual shape
    // every real fixture in this codebase uses ("about $40.00", "about
    // $95.00/year") — never a bare count or a percentage in any shipped
    // prompt or fixture.
    const r = validateOptimizerText("Thinking about 2 renewal dates for the Chase card [ev_1].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "not_conditional_factual")).toBe(true);
  });

  it("the allowlist still accepts 'about' when it actually hedges a dollar figure", () => {
    const r = validateOptimizerText("Cancelling the subscription saves about $12.00 per month [ev_1].", {
      requiresStaleCaveat: false,
    });
    expect(r.status).toBe("PASSED");
  });

  /*
   * NAMED LIMITATION, not fixed here (Codex independent review, money-core
   * PR #23): the allowlist check is TEXT-WIDE, not scoped to the specific
   * claim it is meant to hedge. An unrelated dollar figure elsewhere in the
   * same text can still satisfy it for a DIFFERENT, unhedged claim. This
   * fix narrows the gap (a bare word no longer qualifies) without closing it
   * (claim-scoped hedging would need the validator to reason about WHICH
   * sentence a figure belongs to, a materially larger change than tightening
   * one pattern). Recorded here as a known, accepted boundary of this fix,
   * not a silent gap.
   */
  it("known limitation: an unrelated dollar figure elsewhere in the text still satisfies the allowlist", () => {
    const r = validateOptimizerText(
      "Cancelling the subscription saves $500 immediately. About $12 is listed separately [ev_1].",
      { requiresStaleCaveat: false },
    );
    // Documents the current (accepted) behavior rather than asserting it is
    // ideal: the unhedged "$500" claim rides through on the unrelated
    // "about $12" hedge elsewhere in the text.
    expect(r.status).toBe("PASSED");
  });
});
