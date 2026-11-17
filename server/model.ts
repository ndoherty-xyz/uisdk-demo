import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { recipeSchema, type Recipe, type RecipeRequest } from "../src/recipe/schema";
import { systemPrompt } from "./prompt";

const defaultModel = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5.5";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: { "X-Title": "Show Me Once" },
});

const { $schema: _, ...recipeJsonSchema } = z.toJSONSchema(recipeSchema);

const giveUpMessage = "Couldn't make a recipe from that. Try a hint like 'everyone on Design'.";

type Usage = { promptTokens: number; completionTokens: number; cost: number };

type RecipeCallResult = { model: string; latencyMs: number; attempts: number; usage: Usage } & (
  | { ok: true; recipe: Recipe }
  | { ok: false; error: string; detail?: string }
);

/** OpenRouter extensions to the chat completions request. */
type OpenRouterParams = ChatCompletionCreateParamsNonStreaming & {
  /** Only route to providers that support every parameter sent, so tools aren't dropped. */
  provider: { require_parameters: boolean };
  /** Return `usage.cost` in credits. */
  usage: { include: boolean };
};

// Helpers ----------

/**
 * Function to pull the recipe JSON text out of a completion: the tool call's arguments,
 * or, for models that answer in prose, the outermost `{…}` in the content.
 * @param message The assistant message.
 * @returns The JSON text, or undefined when there's neither.
 */
function extractRecipeJson(message: OpenAI.Chat.Completions.ChatCompletionMessage): string | undefined {
  const toolCall = message.tool_calls?.find((call) => call.type === "function");
  if (toolCall) return toolCall.function.arguments;
  const content = message.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined;
}

/**
 * Function to parse and validate recipe JSON text.
 * @param json The JSON text from the model.
 * @returns The recipe, or a readable error to send back to the model.
 */
function parseRecipe(json: string): { recipe: Recipe } | { error: string } {
  try {
    const result = recipeSchema.safeParse(JSON.parse(json));
    return result.success ? { recipe: result.data } : { error: z.prettifyError(result.error) };
  } catch (error) {
    return { error: `Not valid JSON: ${(error as Error).message}` };
  }
}

// Call ----------

/**
 * Function to ask a model, through OpenRouter, to generalize a recording into a recipe. Invalid
 * output gets one retry with the validation error appended. Shared by the route and the eval.
 * @param request The recording, members, fields and hint.
 * @param model OpenRouter model slug; the server default when absent.
 * @returns The recipe or an error, with latency and token usage summed over attempts.
 */
async function proposeRecipe(request: Omit<RecipeRequest, "model">, model = defaultModel): Promise<RecipeCallResult> {
  const startedAt = performance.now();
  const usage: Usage = { promptTokens: 0, completionTokens: 0, cost: 0 };
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(request) },
  ];
  const finish = (attempts: number, outcome: { ok: true; recipe: Recipe } | { ok: false; error: string; detail?: string }) =>
    ({ model, latencyMs: Math.round(performance.now() - startedAt), attempts, usage, ...outcome }) as RecipeCallResult;

  // Exits by returning: attempt 2 always returns.
  for (let attempt = 1; ; attempt++) {
    const params: OpenRouterParams = {
      model,
      messages,
      max_tokens: 4000,
      tools: [
        {
          type: "function",
          function: {
            name: "propose_recipe",
            description: "Propose a recipe that applies the recorded changes to the right people.",
            parameters: recipeJsonSchema,
          },
        },
      ],
      // Forced tool_choice has no OpenRouter endpoint for Claude 5.5; with one tool, "auto" suffices.
      tool_choice: "auto",
      provider: { require_parameters: true },
      usage: { include: true },
    };

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create(params);
    } catch (error) {
      const message = (error as Error).message;
      // OpenRouter answers 404 when no provider for this model supports tool calls.
      const noToolSupport = (error as { status?: number }).status === 404;
      return finish(attempt, {
        ok: false,
        error: noToolSupport
          ? `${model} didn't return a recipe. Pick a model that supports tool calling.`
          : `${model} request failed: ${message}`,
        detail: message,
      });
    }

    const completionUsage = completion.usage as (OpenAI.CompletionUsage & { cost?: number }) | undefined;
    usage.promptTokens += completionUsage?.prompt_tokens ?? 0;
    usage.completionTokens += completionUsage?.completion_tokens ?? 0;
    usage.cost += completionUsage?.cost ?? 0;

    const message = completion.choices[0]?.message;
    const json = message && extractRecipeJson(message);
    if (!json) {
      return finish(attempt, { ok: false, error: `${model} didn't return a recipe. Pick a model that supports tool calling.` });
    }

    const parsed = parseRecipe(json);
    if ("recipe" in parsed) return finish(attempt, { ok: true, recipe: parsed.recipe });
    if (attempt === 2) return finish(attempt, { ok: false, error: giveUpMessage, detail: parsed.error });

    messages.push({
      role: "user",
      content: `Your propose_recipe arguments were invalid:\n${parsed.error}\n\nYou sent:\n${json}\n\nCall propose_recipe again with a corrected recipe.`,
    });
  }
}

export { defaultModel, proposeRecipe };
export type { RecipeCallResult };
