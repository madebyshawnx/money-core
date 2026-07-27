/**
 * AI output policy validator — the guardrail on AI-generated language.
 *
 * CLAUDE.md hard rules: the product is NOT an AI financial advisor. AI may
 * explain deterministic facts but may NOT make recommendations or prescribe
 * actions affecting investments, credit, loans, taxes, insurance, or money
 * movement. Every AI output must pass prohibited-language checks and include
 * stale-data caveats when relevant.
 *
 * This validator is deterministic and runs on EVERY AI (or template) summary
 * before it can be shown. Prohibited language BLOCKS; a missing required
 * stale-data caveat routes to NEEDS_REVIEW; otherwise PASSED.
 *
 * NOTE (human review required): this file encodes AI policy boundaries. Changes
 * here — and any future wiring of a real LLM provider — must be human-reviewed
 * per CLAUDE.md before production use.
 */

export type PolicyStatus = "PASSED" | "BLOCKED" | "NEEDS_REVIEW";

export interface PolicyViolation {
  code: string;
  message: string;
}

export interface PolicyResult {
  status: PolicyStatus;
  violations: PolicyViolation[];
}

export interface ValidateOptions {
  /** True when the underlying data is stale and the summary must say so. */
  requiresStaleCaveat: boolean;
}

export interface OptimizerInteropCopy {
  title: string;
  statement: string;
  assumptions: string[];
}

/**
 * Prohibited phrasing: recommendations/advice and the banned product/action
 * categories (investing, credit, loans, taxes, insurance, money movement). These
 * target advice and prescriptive verbs, not factual past-tense reporting
 * ("you bought groceries" is fine; "you should buy" is not).
 */
const PROHIBITED_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "advice_recommend", pattern: /\b(recommend|suggest|advise|advis(e|ing)|you\s+should|you\s+ought\s+to|you\s+could|we\s+advise)\b/i },
  {
    code: "prescriptive_money_coaching",
    pattern:
      /\b(consider|try|you\s+should|aim\s+to|focus\s+on|prioritize|make\s+sure\s+to|don't\s+forget\s+to)\b(?:\s+\S+){0,6}\s+\b(reduce|reducing|cut|cutting|lower|lowering|limit|limiting|set|setting|increase|increasing)\b(?:\s+\S+){0,6}\s+\b(spending|budget|expenses?|saving|savings|costs?|bills?|debt|cash|grocery|groceries|dining|subscriptions?)\b/i,
  },
  { code: "investing", pattern: /\b(invest(ing|ment|ments)?|index fund|portfolio|stocks?|securities|buy (shares|stock))\b/i },
  { code: "credit_loans", pattern: /\b(refinanc(e|ing)|consolidat(e|ing)\s+(your\s+)?debt|pay\s*off\s+(your\s+)?(loan|debt|balance|card)|pay\s+down|take\s+out\s+a\s+loan|apply\s+for\s+a\s+(loan|credit)|open\s+a\s+(credit|line))\b/i },
  { code: "taxes", pattern: /\b(tax\s+(advice|strategy|deduction|write[- ]?off)|write\s+it\s+off)\b/i },
  { code: "insurance", pattern: /\b(insurance\s+(policy|plan|coverage)\s+(you|to)|switch\s+insurance|buy\s+insurance)\b/i },
  { code: "money_movement", pattern: /\b(transfer|move|send)\s+(the\s+)?(money|funds|cash|\$)/i },
  { code: "shaming_tone", pattern: /\b(irresponsible|reckless|careless|shameful|lazy|stupid|wasteful|you\s+failed|bad\s+with\s+money|roast)\b/i },
  // docs/26 banned V1 language that must also block a general AI summary (not just
  // optimizer copy). Kept precise so factual reporting ("your best savings month")
  // is not falsely blocked — only advisor positioning, advice/recommendation nouns,
  // guarantees, product superlatives, and debt-settlement phrasing.
  { code: "advisor_positioning", pattern: /\b((ai\s+)?(financial|investment|money|credit)\s+(advisor|adviser|planner)|ai\s+planner\b|financial\s+planning\s+advice)\b/i },
  { code: "advice_noun", pattern: /\b((financial|investment|credit|tax|debt|insurance|personali[sz]ed)\s+advice|(credit|loan|investment|insurance|product)\s+recommendations?)\b/i },
  { code: "guarantee", pattern: /\b(guaranteed?|will\s+save\s+you|risk[- ]free|make\s+you\s+richer)\b/i },
  { code: "product_superlative", pattern: /\b((best|cheapest|lowest[- ]cost|top[- ]rated|optimal)\s+(credit\s+card|card|loan|bank(\s+account)?|account|insurance|policy|fund|etf|investment)|optimal\s+allocation)\b/i },
  { code: "debt_settlement", pattern: /\bdebt\s+(settlement|strateg(y|ies)|prioriti[sz]ation)\b/i },
];

const STALE_CAVEAT_PATTERN = /\b(stale|out[- ]of[- ]date|out of date|may be outdated|not up to date|as of)\b/i;

export function validateSummary(text: string, options: ValidateOptions): PolicyResult {
  const violations: PolicyViolation[] = [];
  const normalizedText = normalizePolicyText(text);

  for (const { code, pattern } of PROHIBITED_PATTERNS) {
    if (pattern.test(normalizedText)) {
      violations.push({ code, message: `Prohibited ${code.replace(/_/g, " ")} language detected.` });
    }
  }
  if (violations.length > 0) {
    return { status: "BLOCKED", violations };
  }

  if (options.requiresStaleCaveat && !STALE_CAVEAT_PATTERN.test(normalizedText)) {
    return {
      status: "NEEDS_REVIEW",
      violations: [{ code: "missing_stale_caveat", message: "Data is stale but the summary has no stale-data caveat." }],
    };
  }

  return { status: "PASSED", violations: [] };
}

const OPTIMIZER_BLOCKS: Array<{ code: string; pattern: RegExp }> = [
  { code: "directive_verb", pattern: /\b(you should|try|consider|prioritize|make sure to|switch to|you\s+can\s+cancel|cancel\s+(this|that|the|your|service|subscription)|cut\s+(this|that|the|your)|lower\s+(this|that|the|your)|move the savings|call today)\b/i },
  { code: "best_cheapest", pattern: /\b(best|cheapest|lowest[- ]cost|top[- ]rated)\b/i },
  { code: "urgency_pressure", pattern: /\b(today|now|limited time|act fast|before it is too late|don't wait)\b/i },
  { code: "guarantee", pattern: /\b(guarantee|guaranteed|will save|promise|risk[- ]free)\b/i },
  { code: "affiliate", pattern: /\b(affiliate|referral|sponsored|paid placement|commission)\b/i },
  { code: "done_for_you", pattern: /\b(we will call|we contact|we negotiate|we cancel|act as your agent|power of attorney|attorney-in-fact)\b/i },
];

const CONDITIONAL_FACTUAL_ALLOWLIST = /\b(appears|if\b|estimated|about|scenario|optional|user makes|does not contact|does not move money|does not guarantee|any provider outcome depends on the provider|renewed)\b/i;

export function validateOptimizerText(text: string, options: ValidateOptions): PolicyResult {
  // ACCUMULATE both layers; do NOT early-return when the base policy blocks.
  //
  // This previously returned `base` as soon as the base policy blocked, which
  // silently truncated the violation list to whichever layer happened to match
  // first. The regression surfaced when the base policy gained a `guarantee`
  // pattern: "Call today to get the best guaranteed discount." went from
  // reporting four reasons (directive_verb, best_cheapest, urgency_pressure,
  // guarantee) to reporting only `guarantee`, because base now matched first.
  //
  // Truncating is wrong for two reasons. An author fixing the copy would have to
  // re-run the validator once per problem, discovering a new one each pass; and
  // the audit trail would record only a fraction of why the copy was rejected.
  //
  // Safe by construction: this cannot make blocked copy pass. If the base policy
  // blocked, its violations are non-empty with a non-`missing_stale_caveat`
  // code, so the check below still returns BLOCKED. The status is unchanged —
  // only the reported reasons grow.
  const base = validateSummary(text, options);
  const violations: PolicyViolation[] = [...base.violations];
  const normalized = normalizePolicyText(text);
  for (const block of OPTIMIZER_BLOCKS) {
    if (block.pattern.test(normalized)) {
      violations.push({ code: block.code, message: `Optimizer copy contains prohibited ${block.code.replace(/_/g, " ")} language.` });
    }
  }
  if (!CONDITIONAL_FACTUAL_ALLOWLIST.test(normalized)) {
    violations.push({ code: "not_conditional_factual", message: "Optimizer copy must be conditional-factual." });
  }

  if (violations.some((v) => v.code !== "missing_stale_caveat")) return { status: "BLOCKED", violations };
  return violations.length > 0 ? { status: "NEEDS_REVIEW", violations } : { status: "PASSED", violations: [] };
}

export function validateOptimizerInteropCopy(opportunity: OptimizerInteropCopy, options: ValidateOptions): PolicyResult {
  return validateOptimizerText([opportunity.title, opportunity.statement, ...opportunity.assumptions].join(" "), options);
}

function normalizePolicyText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
