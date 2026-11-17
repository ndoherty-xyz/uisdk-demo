import { readSettingsByMember } from "../bridge";
import { fields } from "../data/fields";
import { memberById, members } from "../data/members";
import type { Recording } from "../record/recording";
import { recipeSchema, type Recipe, type RecipeRequest, type RecipeResponse } from "./schema";

const giveUpMessage = "Couldn't make a recipe from that. Try a hint like 'everyone on Design'.";

/**
 * Function to ask the server for a recipe from a recording, with everyone's current settings read
 * from the page, and validate the answer.
 * @param recording The one-person recording.
 * @param hint Who to apply it to, in the person's words; may be empty.
 * @param model OpenRouter slug; empty for the server default.
 * @returns The recipe, or an error to show in the bar.
 */
async function requestRecipe(recording: Recording, hint: string, model: string): Promise<{ recipe: Recipe } | { error: string }> {
  const settingsByMember = readSettingsByMember();
  const request: RecipeRequest = {
    recorded: { member: memberById.get(recording.memberId)!, changes: recording.changes },
    members: members.map((member) => ({ ...member, settings: settingsByMember.get(member.id)! })),
    fields,
    ...(hint.trim() && { hint: hint.trim() }),
    ...(model.trim() && { model: model.trim() }),
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
