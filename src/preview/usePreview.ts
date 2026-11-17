import { useSyncExternalStore } from "react";
import type { Recipe } from "../recipe/schema";

/** The recipe the table is previewing, and the member the example came from (already done). */
type PreviewedRecipe = { recipe: Recipe; recordedMemberId: string };

// One preview for the whole page, so this is module state, not component state.
let previewedRecipe: PreviewedRecipe | null = null;
const previewListeners = new Set<() => void>();

/**
 * Function to preview a recipe on every row it would change. Null stops previewing.
 * @param recipe The recipe, or null.
 * @param recordedMemberId The member the example came from.
 */
function previewRecipe(recipe: Recipe | null, recordedMemberId: string) {
  previewedRecipe = recipe && { recipe, recordedMemberId };
  for (const listener of previewListeners) listener();
}

/**
 * Function to subscribe a component to the previewed recipe.
 * @returns The previewed recipe, or null.
 */
function usePreviewedRecipe(): PreviewedRecipe | null {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    () => previewedRecipe,
  );
}

export { previewRecipe, usePreviewedRecipe };
