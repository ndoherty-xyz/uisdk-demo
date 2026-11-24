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
- **Voice.** Talk to the table with GPT-Live. "Show me design in Mexico City", then edit one row by hand and say "do that
  for the rest": a tool over the history finds your latest edits and copies them to everyone shown. Changes to 10
  people or fewer run right away; bigger ones ask first. "Undo that" reverts the agent's changes and keeps yours, and
  "put back Jade's" re-applies some of them.

## Running it

```
pnpm install
cp .env.example .env   # add an OpenRouter API key, and an OpenAI key for voice
pnpm dev
```

The web app runs on Vite, with a small Hono server on :8787. The server calls the rule model through OpenRouter and
creates voice sessions with OpenAI: GPT-Live (`LIVE_MODEL`) talks, and hands table work to a Responses model
(`BACKEND_MODEL`) whose tool calls run in the page. Click the mic in the agent pill to start; add `?debug` to log voice
events in the console.

## Checks

```
pnpm typecheck
pnpm test
pnpm e2e
```
