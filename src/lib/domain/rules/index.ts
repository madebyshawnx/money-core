/**
 * Rules engine — public surface.
 *
 * `RuleService` (docs/06 names it `RuleService`) is the immutable facade over
 * the Phase-4 rules engine, mirroring the shape of `LedgerService`. It holds a
 * rule set and exposes deterministic classification, active-match queries, and
 * user-facing rule suggestions. The transaction inbox is a derived view exported
 * as `selectInbox` (see inbox.ts) rather than a service method, since the docs
 * model it as a view over transaction state.
 */

import type { Rule, Transaction } from "@/lib/domain/types";
import {
  classifyTransaction,
  classifyTransactions,
  type ApplyContext,
  type ClassifyManyOutcome,
  type ClassifyOutcome,
} from "./apply";
import { matchingActiveRules } from "./match";
import { matchingSuggestedRules } from "./inbox";

export * from "./match";
export * from "./apply";
export * from "./inbox";

export class RuleService {
  constructor(private readonly ruleSet: Rule[] = []) {}

  /** The immutable rule set backing this service. */
  get rules(): readonly Rule[] {
    return this.ruleSet;
  }

  /** Classify a batch of transactions with the ACTIVE rules, collecting applications. */
  classify(transactions: Transaction[], ctx: ApplyContext): ClassifyManyOutcome {
    return classifyTransactions(this.ruleSet, transactions, ctx);
  }

  /** Classify a single transaction with the first matching ACTIVE rule. */
  classifyOne(transaction: Transaction, ctx: ApplyContext): ClassifyOutcome {
    return classifyTransaction(this.ruleSet, transaction, ctx);
  }

  /** ACTIVE rules that match a transaction, in precedence order. */
  matchingActiveRules(transaction: Transaction): Rule[] {
    return matchingActiveRules(this.ruleSet, transaction);
  }

  /** SUGGESTED rules proposed (not applied) for a transaction. */
  suggestionsFor(transaction: Transaction): Rule[] {
    return matchingSuggestedRules(this.ruleSet, transaction);
  }
}
