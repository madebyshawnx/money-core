## Summary

Describe what changed and why.

## Tests

- [ ] Unit tests added/updated (edge cases: zero, negative, large values, empty arrays)
- [ ] Lint passes
- [ ] Typecheck passes

Commands run:

```bash
# paste commands here
```

## Consumer impact

This package is consumed by Cadence, Money Manager, and (planned) PennyBank
via SHA-pinned git dependencies — a change here ships nowhere until each
consumer bumps its pin.

- [ ] Breaking change? If so, version bumped and both consumers' adoption noted below
- [ ] Money values stay integer cents (PennyBank's float-dollar boundary is the consumer's problem to convert, never this package's to accept)
- [ ] Behavior changes are reflected in the interop/engine-parity expectations of consumers where applicable

## Known gaps

List any remaining gaps or follow-up tasks.
