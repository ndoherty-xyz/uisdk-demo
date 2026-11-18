import type { HistoryEntry } from "@ui-sdk/react/history";
import { useEffect, useRef, useState } from "react";
import { entryTimes, history, memberIdOfEntry } from "../bridge";
import { readSettings } from "../data/settingsStore";
import { requestRecipe } from "../recipe/requestRecipe";
import type { Recipe } from "../recipe/schema";
import { findRepeatedChange, type Recording } from "./recording";

/** A pause this long after the person's last change ends their edits, and only then is it checked. */
const breakMs = 1500;

/** Two rows changed the same way by hand, with a recipe already made from them. */
type Nudge = { examples: [Recording, Recording]; recipe: Recipe };

/**
 * Function to watch for the person leaving two rows in the same end state by hand and, at the next
 * pause, make a recipe from both in the background so the offer arrives ready. Each change set is
 * offered at most once per session, and rows edited before an offer don't count towards the next.
 * @param isWatching Whether the bar is idle, so a nudge could show.
 * @returns The examples spotted while their recipe is being made, the ready nudge, and a way to drop it.
 */
function useNudge(isWatching: boolean) {
  const [spottedExamples, setSpottedExamples] = useState<[Recording, Recording] | null>(null);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const offeredKeys = useRef(new Set<string>());
  const lastSpottedAt = useRef(0);

  useEffect(() => {
    if (!isWatching) return;
    let detectTimer: ReturnType<typeof setTimeout> | undefined;
    // A recipe that arrives after the person started something else is dropped, not shown later.
    let isCancelled = false;
    /**
     * Function to look for a repeated change and, if there is one, make its recipe.
     * @param entries The history entries to look in, oldest first.
     */
    async function detectRepeatedChange(entries: HistoryEntry[]) {
      const repeated = findRepeatedChange(
        entries.filter((entry) => entryTimes.get(entry.id)! > lastSpottedAt.current),
        (entryId) => entryTimes.get(entryId)!,
        memberIdOfEntry,
        readSettings,
        offeredKeys.current,
      );
      if (!repeated) return;
      offeredKeys.current.add(repeated.key);
      lastSpottedAt.current = Date.now();
      setSpottedExamples(repeated.recordings);
      const result = await requestRecipe(repeated.recordings, "");
      if (isCancelled) return;
      setSpottedExamples(null);
      if ("recipe" in result) setNudge({ examples: repeated.recordings, recipe: result.recipe });
    }

    const unsubscribe = history.subscribe(() => {
      const entries = history.entries().slice(0, history.position());
      const latestEntry = entries.at(-1);
      if (!latestEntry || latestEntry.source === "agent") return;
      clearTimeout(detectTimer);
      detectTimer = setTimeout(() => detectRepeatedChange(entries), breakMs);
    });
    return () => {
      isCancelled = true;
      setSpottedExamples(null);
      clearTimeout(detectTimer);
      unsubscribe();
    };
  }, [isWatching]);

  /** Function to drop the nudge; its change set stays offered. */
  function dismissNudge() {
    setNudge(null);
  }

  return { spottedExamples, nudge, dismissNudge };
}

export { useNudge };
export type { Nudge };
