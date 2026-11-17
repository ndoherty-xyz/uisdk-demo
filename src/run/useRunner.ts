import type { HistoryEntry } from "@ui-sdk/react/history";
import { useRef, useState } from "react";
import { agent, history, memberIdOfRef, queryMemberControls } from "../bridge";
import type { Member } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { changesFor, matches } from "../recipe/evaluate";
import { plan } from "../recipe/plan";
import type { Recipe } from "../recipe/schema";
import { flashChangedCell, hideGhostCursor, moveGhostCursor } from "../ui/GhostCursor";
import { readVisibleMembers, scrollToMember } from "../ui/tableVirtualizer";

/** Pause after each change of the first rows, so it's readable. */
const stepPauseMs = 180;
/** Rows shown change by change; the rest go a row at a time, quicker and quicker. */
const animatedRowCount = 3;
const animatedGlideMs = 450;
const batchGlideMs = { first: 200, fastest: 90, speedUpPerRow: 10 };

type RunState =
  | { phase: "idle" }
  | { phase: "running"; member: Member; index: number; total: number; stopping: boolean }
  | { phase: "finished"; changedCount: number; failedStepCount: number; stopped: boolean };

/** One row's share of a run: the history entries the agent made on it. */
type RunTurn = { member: Member; entries: HistoryEntry[] };

/** One run of a recipe, keyed by when it started. */
type AgentRun = { startedAt: number; recipe: Recipe; turns: RunTurn[] };

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
 * @returns The run state, every run so far, and their actions.
 */
function useRunner() {
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const stopRequested = useRef(false);

  /**
   * Function to apply a recipe to every run target, one row at a time, scrolling each into view.
   * The ghost cursor visits every row: the first change by change, the rest a row per `act`, speeding up.
   * @param recipe The recipe.
   */
  async function runRecipe(recipe: Recipe) {
    const targets = findRunTargets(recipe);
    stopRequested.current = false;
    let changedCount = 0;
    let failedStepCount = 0;
    setRuns((current) => [...current, { startedAt: Date.now(), recipe, turns: [] }]);

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
      setRuns((current) =>
        current.with(-1, { ...current.at(-1)!, turns: [...current.at(-1)!.turns, { member, entries: turnEntries }] }),
      );
    }

    hideGhostCursor();
    setRunState({ phase: "finished", changedCount, failedStepCount, stopped: stopRequested.current });
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

  /** Function to forget every run without reverting anything. */
  function clearRuns() {
    setRuns([]);
  }

  return { runState, runs, runRecipe, stopRun, resetRunner, clearRuns };
}

export { findRunTargets, useRunner };
export type { AgentRun, RunState, RunTurn };
