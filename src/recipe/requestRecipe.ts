import { fields } from "../data/fields";
import { attributeValueCounts, memberById } from "../data/members";
import type { Recording } from "../record/recording";
import { recipeSchema, type Recipe, type RecipeRequest, type RecipeResponse } from "./schema";

const giveUpMessage = "Couldn't make a recipe from that. Try a hint like 'everyone on Design'.";

/**
 * Function to ask the server for a recipe from one or more recordings of the same change, and
 * validate the answer.
 * @param recordings One recording per example row.
 * @param hint What the person wants, in their own words; may be empty.
 * @param currentRecipe The recipe the hint edits, if there is one.
 * @returns The recipe, or an error to show in the bar.
 */
async function requestRecipe(
  recordings: Recording[],
  hint: string,
  currentRecipe?: Recipe,
): Promise<{ recipe: Recipe } | { error: string }> {
  const request: RecipeRequest = {
    recorded: recordings.map((recording) => ({
      member: memberById.get(recording.memberId)!,
      changes: recording.changes,
    })),
    attributeValueCounts,
    fields,
    ...(hint.trim() && { hint: hint.trim() }),
    ...(currentRecipe && { current: currentRecipe }),
  };
  try {
    const response = await fetch("/api/recipe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as RecipeResponse;
    if ("error" in body) return { error: body.error };
    const parsed = recipeSchema.safeParse(body.recipe);
    return parsed.success ? { recipe: parsed.data } : { error: giveUpMessage };
  } catch {
    return { error: giveUpMessage };
  }
}

export { requestRecipe };
