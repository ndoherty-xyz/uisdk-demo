import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { APIError } from "openai";
import { createLiveSession } from "./live";
import type { RecipeRequest, RecipeResponse } from "../src/recipe/schema";
import { proposeRecipe } from "./model";

const isDev = process.env.NODE_ENV !== "production";

const app = new Hono();

app.post("/api/recipe", async (c) => {
  const { model, ...request } = await c.req.json<RecipeRequest>();
  if (isDev) console.log("→ /api/recipe", JSON.stringify(request));

  const result = await proposeRecipe(request, model || undefined);
  if (isDev) {
    const { promptTokens, completionTokens, cost } = result.usage;
    console.log(
      `← ${result.model} ${result.ok ? "ok" : "error"} ${result.latencyMs}ms attempts=${result.attempts} tokens=${promptTokens}/${completionTokens} cost=$${cost.toFixed(5)}`,
    );
    console.log(JSON.stringify(result.ok ? result.recipe : { error: result.error, detail: result.detail }));
  }

  const response: RecipeResponse = result.ok ? { recipe: result.recipe, model: result.model } : { error: result.error };
  return c.json(response, result.ok ? 200 : 502);
});

app.post("/api/session", async (c) => {
  const { sdp } = await c.req.json<{ sdp: string }>();
  try {
    const live = await createLiveSession(sdp);
    if (isDev) console.log(`live session ${live.session.id}`);
    return c.json({ sessionId: live.session.id, sdp: live.transport.sdp });
  } catch (error) {
    const status = error instanceof APIError && error.status ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error("live session failed:", message);
    return c.json({ error: message }, status as ContentfulStatusCode);
  }
});

// Dev only: the voice page echoes its events here so they show in the server log.
app.post("/api/log", async (c) => {
  if (isDev) console.log("[voice]", await c.req.text());
  return c.body(null, 204);
});

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
