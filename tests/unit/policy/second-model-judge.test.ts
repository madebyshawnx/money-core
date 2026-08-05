import { describe, it, expect, vi } from "vitest";
import { validateSummary } from "@/lib/domain/policy/validate";
import {
  judgeSummary,
  validateSummaryWithJudge,
  type JudgeFn,
} from "@/lib/domain/policy/second-model-judge";

const clean =
  "This week you spent $420.00 across your accounts and received $4,120.00 in income. Three transactions need your review.";

const regexBlocked = "You should invest in an index fund and pay off your loan.";

/** A judge that allows everything. */
const allowJudge: JudgeFn = async () => JSON.stringify({ allow: true, reason: "factual reporting only" });

/** A judge that blocks everything with a fixed reason. */
const blockJudge: JudgeFn = async () =>
  JSON.stringify({ allow: false, reason: "implied financial recommendation" });

describe("second-model judge — composition rule (additive only)", () => {
  it("regex-blocked + judge-allow stays BLOCKED; the judge can never un-block", async () => {
    const spy = vi.fn(allowJudge);
    const r = await validateSummaryWithJudge(regexBlocked, { requiresStaleCaveat: false }, { judgeFn: spy });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.judgeUnavailable).toBe(false);
    // The judge is not even consulted on a regex block — its verdict cannot matter.
    expect(spy).not.toHaveBeenCalled();
  });

  it("regex-pass + judge-block becomes BLOCKED with the judge reason", async () => {
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: blockJudge });
    expect(r.status).toBe("BLOCKED");
    expect(r.judgeUnavailable).toBe(false);
    const judgeViolation = r.violations.find((v) => v.code === "judge_blocked");
    expect(judgeViolation).toBeDefined();
    expect(judgeViolation!.message).toContain("implied financial recommendation");
  });

  it("regex-pass + judge-allow stays PASSED", async () => {
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: allowJudge });
    expect(r.status).toBe("PASSED");
    expect(r.violations).toHaveLength(0);
    expect(r.judgeUnavailable).toBe(false);
  });

  it("NEEDS_REVIEW (missing stale caveat) + judge-allow stays NEEDS_REVIEW", async () => {
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: true }, { judgeFn: allowJudge });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.violations.some((v) => v.code === "missing_stale_caveat")).toBe(true);
    expect(r.judgeUnavailable).toBe(false);
  });

  it("NEEDS_REVIEW + judge-block escalates to BLOCKED and keeps both violations", async () => {
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: true }, { judgeFn: blockJudge });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.some((v) => v.code === "missing_stale_caveat")).toBe(true);
    expect(r.violations.some((v) => v.code === "judge_blocked")).toBe(true);
  });
});

describe("second-model judge — fail-open to regex-only protection", () => {
  it("no judgeFn provided → regex result + judgeUnavailable marker", async () => {
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, {});
    expect(r.status).toBe("PASSED");
    expect(r.violations).toHaveLength(0);
    expect(r.judgeUnavailable).toBe(true);
  });

  it("judgeFn rejecting (network error) → regex result + judgeUnavailable marker", async () => {
    const failing: JudgeFn = async () => {
      throw new Error("ECONNRESET");
    };
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: failing });
    expect(r.status).toBe("PASSED");
    expect(r.judgeUnavailable).toBe(true);
  });

  it("judgeFn hanging past the timeout → regex result + judgeUnavailable marker", async () => {
    const hanging: JudgeFn = () => new Promise<string>(() => {});
    const r = await validateSummaryWithJudge(
      clean,
      { requiresStaleCaveat: false },
      { judgeFn: hanging, timeoutMs: 25 },
    );
    expect(r.status).toBe("PASSED");
    expect(r.judgeUnavailable).toBe(true);
  });

  it("unavailable judge never hides a regex NEEDS_REVIEW", async () => {
    const failing: JudgeFn = async () => {
      throw new Error("boom");
    };
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: true }, { judgeFn: failing });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.violations.some((v) => v.code === "missing_stale_caveat")).toBe(true);
    expect(r.judgeUnavailable).toBe(true);
  });

  it.each([
    ["plain prose, no JSON", "I think this text is fine to show."],
    ["JSON array", JSON.stringify([{ allow: true }])],
    ["JSON null", "null"],
    ["JSON number", "42"],
    ["allow is a string, not a boolean", JSON.stringify({ allow: "true", reason: "typed wrong" })],
    ["allow missing entirely", JSON.stringify({ verdict: "ok" })],
    ["empty string", ""],
  ])("malformed judge output (%s) counts as unavailable, never as a verdict", async (_label, raw) => {
    const malformed: JudgeFn = async () => raw;
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: malformed });
    expect(r.status).toBe("PASSED");
    expect(r.judgeUnavailable).toBe(true);
  });
});

describe("second-model judge — verdict JSON parsing hardening", () => {
  it("accepts a verdict wrapped in a markdown code fence", async () => {
    const fenced: JudgeFn = async () =>
      '```json\n{"allow": false, "reason": "urgency pressure"}\n```';
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: fenced });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.find((v) => v.code === "judge_blocked")!.message).toContain("urgency pressure");
  });

  it("accepts a verdict surrounded by prose", async () => {
    const chatty: JudgeFn = async () =>
      'Here is my verdict: {"allow": false, "reason": "product recommendation"} — hope that helps!';
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: chatty });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.find((v) => v.code === "judge_blocked")!.message).toContain("product recommendation");
  });

  it("ignores extra keys in an otherwise valid verdict", async () => {
    const extra: JudgeFn = async () =>
      JSON.stringify({ allow: true, reason: "ok", confidence: 0.98, model: "x" });
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: extra });
    expect(r.status).toBe("PASSED");
    expect(r.judgeUnavailable).toBe(false);
  });

  it("honors a block verdict whose reason is missing (safe direction) with a fallback message", async () => {
    const noReason: JudgeFn = async () => JSON.stringify({ allow: false });
    const r = await validateSummaryWithJudge(clean, { requiresStaleCaveat: false }, { judgeFn: noReason });
    expect(r.status).toBe("BLOCKED");
    const v = r.violations.find((x) => x.code === "judge_blocked");
    expect(v).toBeDefined();
    expect(v!.message.length).toBeGreaterThan(0);
  });
});

describe("second-model judge — judgeSummary API", () => {
  it("sends the policy statement and the candidate text to the judge", async () => {
    const spy = vi.fn(allowJudge);
    const outcome = await judgeSummary("Candidate summary text.", { judgeFn: spy });
    expect(outcome.available).toBe(true);
    if (outcome.available) {
      expect(outcome.verdict).toEqual({ allow: true, reason: "factual reporting only" });
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0];
    expect(input.system.toLowerCase()).toContain("financial advice");
    expect(input.system.toLowerCase()).toContain("money movement");
    expect(input.user).toContain("Candidate summary text.");
  });

  it("reports unavailable with a reason when no judgeFn is configured", async () => {
    const outcome = await judgeSummary("anything", {});
    expect(outcome.available).toBe(false);
    if (!outcome.available) {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Semantic bypasses: plain-English advice phrasings the regex layer does NOT
 * catch (asserted below, so this battery stays honest if the regexes evolve).
 * The judge layer is the control that catches them.
 */
const SEMANTIC_BYPASSES = [
  "You might consider moving your savings into a high-yield account.",
  "It would be wise to clear the balance on card X before card Y.",
  "Putting a bit more toward the Visa each month would leave you better off.",
  "A smarter play here is shifting what's left over into your emergency fund each payday.",
  "Most people in your situation would be better off cancelling a streaming service or two.",
  "If it were my money, I'd redirect the dining-out cash into the joint account.",
];

describe("second-model judge — semantic bypass battery", () => {
  it.each(SEMANTIC_BYPASSES)("regex alone misses: %s", (text) => {
    // Pin that these phrasings genuinely bypass the regex layer. If a future
    // regex catches one, move it out of this battery.
    expect(validateSummary(text, { requiresStaleCaveat: false }).status).toBe("PASSED");
  });

  it.each(SEMANTIC_BYPASSES)("judge layer blocks: %s", async (text) => {
    const r = await validateSummaryWithJudge(text, { requiresStaleCaveat: false }, { judgeFn: blockJudge });
    expect(r.status).toBe("BLOCKED");
    expect(r.violations.find((v) => v.code === "judge_blocked")!.message).toContain(
      "implied financial recommendation",
    );
  });
});
