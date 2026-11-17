import { serve } from "@hono/node-server";
import { Hono } from "hono";

const defaultModel = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-5.5";

const app = new Hono();

app.get("/api/config", (c) => c.json({ model: defaultModel }));

// Filled in at M2 (server/model.ts).
app.post("/api/recipe", (c) => c.json({ error: "Not implemented yet" }, 501));

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
