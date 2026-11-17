# Working in this repo

Start with [docs/prd.md](docs/prd.md): the concept, the design, and the milestones in order.

## Writing code

- **Use built-in types over custom classes.** Don't write a class that only wraps a collection plus a
  rule for adding to it. Use a `Map`/`Set`/array and one plain function.
- **Inline single-use helpers.** If a function is called from one place and its name doesn't explain
  more than its body, put the body where it's used (with a one-line comment if the code isn't
  self-explanatory).
- **Name things explicitly.** Function names say what they do and to what (`refreshTargetRects`, not
  `refresh`); variables say what they hold (`targetRects`, not `rects` when there are several kinds).
- **JSDoc every function, briefly.** One line starting "Function to ...", then `@param` for each
  argument and `@returns`. Say what, not how. TypeScript only; Python keeps its docstrings.
- **Reuse before adding.** Before a new type or helper, check whether existing data or an existing
  helper can carry the case.
- **Write code for the data you actually have.** Don't filter or guard against cases the data can't
  produce. Prefer regex literals over `String.raw`/escaped strings.
- **Split longer files into sections** with separator comments (`// Overlay ----------`), helpers above
  the main function they serve.
- **Keep the first version simple.** Write the smallest thing that works, then explain it. Ask before
  adding layers rather than making the user untangle them.

## Comments

Keep them short. A one- or two-line comment on a genuinely confusing part is worth writing; a
paragraph explaining the reasoning behind a design decision is not. Notes on *why* a number or an
experiment turned out the way it did belong in `docs/`, not above the code.

Do not restate what the code says, and do not narrate a change. Git history covers that.

## Scope

- One predictor in the extension at a time. Run comparisons offline over recorded traces, not behind
  flags in the extension.
- Keep `src/baselines.ts` and `src/model.ts` pure (no DOM, no `chrome.*`) so traces can be replayed through them in Node.
- Traces are geometry only. Never store URLs, page text, element contents or selectors.
- Inference runs on the CPU in plain TypeScript. No WebGPU.

## Checks

```
npm run typecheck
npm run build
npm test
```

Tests use `node --test`; Node 22.18+ runs `.ts` tests directly.
