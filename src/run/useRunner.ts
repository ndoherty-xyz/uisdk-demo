import { useRef, useState } from "react";
import { agent, history, memberIdOfRef, queryMemberControls } from "../bridge";
import type { Member } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { changesFor, matches } from "../recipe/evaluate";
import { plan } from "../recipe/plan";
import type { Recipe } from "../recipe/schema";
import { flashChangedCell, hideGhostCursor, moveGhostCursor } from "../ui/GhostCursor";
import { readVisibleMembers, scrollToMember } from "../ui/tableVirtualizer";
import { addRunTurn, startRun } from "./runStore";

/** Pause after each change of the first rows, so it's readable. */
const stepPauseMs = 100;
/** Rows shown change by change; the rest go a row at a time, quicker and quicker. */
const animatedRowCount = 3;
const animatedGlideMs = 300;
const batchGlideMs = { first: 200, fastest: 90, speedUpPerRow: 10 };

type RunState =
  | { phase: "idle" }
  | { phase: "running"; member: Member; index: number; total: number; stopping: boolean }
  | { phase: "finished"; changedCount: number; failedStepCount: number; stopped: boolean };

/**
 * Function to list who a run would change: matching members the table's filters show, minus anyone
 * who already has every value (the examples, for one).
 * @param recipe The recipe.
 * @returns The members to update, in the table's current order.
 */
function findRunTargets(recipe: Recipe): Member[] {
  return readVisibleMembers().filter((member) => {
    const settings = readSettings(member.id);
    return matches(recipe, member, settings) && changesFor(recipe, member, settings).length > 0;
  });
}

/**
 * Function to drive a run: applies a recipe to each target row in order, one `act` per step.
 * @returns The run state and its actions.
 */
function useRunner() {
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const stopRequested = useRef(false);

  /**
   * Function to apply a recipe to every run target, one row at a time, scrolling each into view.
   * The ghost cursor visits every row: the first change by change, the rest a row per `act`, speeding up.
   * @param recipe The recipe.
   * @returns How many rows changed, how many steps failed, and whether it was stopped.
   */
  async function runRecipe(recipe: Recipe) {
    const targets = findRunTargets(recipe);
    stopRequested.current = false;
    let changedCount = 0;
    let failedStepCount = 0;
    startRun(recipe.audience, recipe);

    // Always finish, so a failed step never leaves the panel stuck on "Updating".
    try {
      for (const [index, member] of targets.entries()) {
        if (stopRequested.current) break;
        setRunState({ phase: "running", member, index, total: targets.length, stopping: false });
        const turnStart = history.position();
        const isAnimated = index < animatedRowCount;
        const glideMs = isAnimated
          ? animatedGlideMs
          : Math.max(batchGlideMs.fastest, batchGlideMs.first - (index - animatedRowCount) * batchGlideMs.speedUpPerRow);
        await scrollToMember(member.id, glideMs);
        const steps = plan(recipe, member, await queryMemberControls(member.name, member.id), memberIdOfRef);
        const actSteps = steps.filter((step) => step.ref);
        failedStepCount += steps.length - actSteps.length;
        if (isAnimated) {
          for (const step of actSteps) {
            if (stopRequested.current) break;
            await moveGhostCursor(step.ref!, glideMs);
            const result = await agent.act({ steps: [{ ref: step.ref!, action: step.action, args: step.args }] });
            if (result.ok) flashChangedCell(step.ref!);
            else failedStepCount++;
            await new Promise((resolve) => setTimeout(resolve, stepPauseMs));
          }
        } else {
          // act takes about as long as a quick glide, so the change lands as the cursor arrives.
          const [result] = await Promise.all([
            agent.act({ steps: actSteps.map((step) => ({ ref: step.ref!, action: step.action, args: step.args })) }),
            moveGhostCursor(actSteps[0]!.ref!, glideMs),
          ]);
          // act stops at the first failing step; that one and the rest weren't made.
          const madeCount = result.error ? result.error.step : actSteps.length;
          failedStepCount += actSteps.length - madeCount;
          for (const step of actSteps.slice(0, madeCount)) flashChangedCell(step.ref!);
        }
        changedCount++;
        // The person may edit other rows mid-run; only the agent's entries belong to this turn.
        const turnEntries = history
          .entries()
          .slice(turnStart)
          .filter((entry) => entry.source === "agent");
        addRunTurn({ member, entries: turnEntries });
      }
    } finally {
      hideGhostCursor();
      setRunState({ phase: "finished", changedCount, failedStepCount, stopped: stopRequested.current });
    }
    return { changedCount, failedStepCount, stopped: stopRequested.current };
  }

  /** Function to stop after the current step. */
  function stopRun() {
    stopRequested.current = true;
    setRunState((state) => (state.phase === "running" ? { ...state, stopping: true } : state));
  }

  /** Function to forget a finished run. */
  function resetRunner() {
    setRunState({ phase: "idle" });
  }

  return { runState, runRecipe, stopRun, resetRunner };
}

export { findRunTargets, useRunner };
export type { RunState };
