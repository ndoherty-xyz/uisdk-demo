# ui-sdk demo

A small demo of [ui-sdk](https://ui-sdk.dev)'s history. A table of 1,000 team members, built with ui-sdk components,
and an agent that watches the history for edits you repeat by hand and offers to do the rest.



https://github.com/user-attachments/assets/f73950ba-b60c-403e-901c-57a5ec72fc05



- **Spotting patterns.** Change two rows the same way and, after a pause, the agent offers a rule (the changes, and who
  they apply to) made by an LLM from your edits. You can adjust it in words, or ask for a rule directly from the sidebar.
- **Running it.** The agent makes each change through the table's own controls with `agent.act`, so its edits land in
  the same history, marked as the agent's.
- **Undo.** Because every entry records its source, undoing a run reverts the agent's changes and leaves yours alone,
  even ones made after.

## Running it

```
pnpm install
cp .env.example .env   # add an OpenRouter API key
pnpm dev
```

The web app runs on Vite, with a small Hono server on :8787 that calls the model through OpenRouter.

## Checks

```
pnpm typecheck
pnpm test
pnpm e2e
```
