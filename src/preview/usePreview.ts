import { useSyncExternalStore } from "react";
import type { Recipe } from "../recipe/schema";

// One preview for the whole page, so this is module state, not component state.
let previewedRecipe: Recipe | null = null;
const previewListeners = new Set<() => void>();

/**
 * Function to preview a recipe on every row it would change. Null stops previewing.
 * @param recipe The recipe, or null.
 */
function previewRecipe(recipe: Recipe | null) {
  previewedRecipe = recipe;
  for (const listener of previewListeners) listener();
}

/**
 * Function to subscribe a component to the previewed recipe.
 * @returns The previewed recipe, or null.
 */
function usePreviewedRecipe(): Recipe | null {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    () => previewedRecipe,
  );
}

export { previewRecipe, usePreviewedRecipe };
