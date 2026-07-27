import { describe, it, expect } from "vitest";
import { validateSummary } from "@/lib/domain/policy/validate";

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
