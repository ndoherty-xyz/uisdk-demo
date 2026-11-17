import { useEffect, useRef, useState } from "react";
import { entryTimes, history, memberIdOfEntry } from "../bridge";
import { requestRecipe } from "../recipe/requestRecipe";
import type { Recipe } from "../recipe/schema";
import { findRepeatedChange, type Recording } from "./recording";

/** Wait this long after the person's last change, so a row being edited is finished first. */
const detectDelayMs = 2000;

/** Two rows changed the same way by hand, with a recipe already made from them. */
type Nudge = { examples: [Recording, Recording]; recipe: Recipe };

/**
 * Function to watch for the person making the same change set on two rows by hand and, once
 * found, make a recipe from both in the background so the offer arrives ready. Each change set is
 * offered at most once per session.
 * @param isWatching Whether the bar is idle, so a nudge could show.
 * @param model OpenRouter slug for the recipe; empty for the server default.
 * @returns The examples spotted while their recipe is being made, the ready nudge, and a way to drop it.
 */
function useNudge(isWatching: boolean, model: string) {
  const [spottedExamples, setSpottedExamples] = useState<[Recording, Recording] | null>(null);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const offeredKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!isWatching) return;
    let detectTimer: ReturnType<typeof setTimeout> | undefined;
    // A recipe that arrives after the person started something else is dropped, not shown later.
    let isCancelled = false;
    const unsubscribe = history.subscribe(() => {
      if (history.entries().at(-1)?.source === "agent") return;
      clearTimeout(detectTimer);
      detectTimer = setTimeout(async () => {
        const repeated = findRepeatedChange(
          history.entries().slice(0, history.position()),
          (entryId) => entryTimes.get(entryId)!,
          memberIdOfEntry,
          offeredKeys.current,
        );
        if (!repeated) return;
        offeredKeys.current.add(repeated.key);
        setSpottedExamples(repeated.recordings);
        const result = await requestRecipe(repeated.recordings, "", model);
        if (isCancelled) return;
        setSpottedExamples(null);
        if ("recipe" in result) setNudge({ examples: repeated.recordings, recipe: result.recipe });
      }, detectDelayMs);
    });
    return () => {
      isCancelled = true;
      setSpottedExamples(null);
      clearTimeout(detectTimer);
      unsubscribe();
    };
  }, [isWatching, model]);

  /** Function to drop the nudge; its change set stays offered. */
  function dismissNudge() {
    setNudge(null);
  }

  return { spottedExamples, nudge, dismissNudge };
}

export { useNudge };
export type { Nudge };
