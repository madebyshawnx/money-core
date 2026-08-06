/**
 * Policy barrel. Two layers, one subpath:
 *
 * - `validate.ts` — the mandatory, deterministic regex layer. Untouched by the
 *   judge work; its exports and behavior are exactly what consumers pinned.
 * - `second-model-judge.ts` — the opt-in semantic layer (CODEX P1-4). Additive
 *   only: it can add blocks on top of the regex result, never remove one, and
 *   fails open to the regex-only result when the judge is unavailable.
 */
export * from "./validate";
export * from "./second-model-judge";
