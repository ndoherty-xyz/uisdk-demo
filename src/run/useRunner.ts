import { useRef, useState } from "react";
import { agent, memberIdOfRef, readSettingsByMember } from "../bridge";
import { members, type Member } from "../data/members";
import { changesFor, matches } from "../recipe/evaluate";
import { plan } from "../recipe/plan";
import type { Recipe } from "../recipe/schema";

/** Pause after each change so it's readable. */
const stepPauseMs = 180;

type RunState =
  | { phase: "idle" }
  | { phase: "running"; member: Member; index: number; total: number; stopping: boolean }
  | { phase: "finished"; changedCount: number; failedStepCount: number; stopped: boolean };

/**
 * Function to list who a run would change: matching members except the recorded one, minus anyone
 * who already has every value. Reads current values from a fresh snapshot.
 * @param recipe The recipe.
 * @param recordedMemberId The member the recording came from; already done.
 * @returns The members to update, in table order.
 */
function findRunTargets(recipe: Recipe, recordedMemberId: string): Member[] {
  const settingsByMember = readSettingsByMember();
  return members.filter(
    (member) =>
      member.id !== recordedMemberId &&
      matches(recipe, member) &&
      changesFor(recipe, member, settingsByMember.get(member.id)!).length > 0,
  );
}

/**
 * Function to drive a run: applies a recipe to each target row in order, one `act` per step.
 * @returns The run state and its actions.
 */
function useRunner() {
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const stopRequested = useRef(false);

  /**
   * Function to apply a recipe to every run target, one row at a time.
   * @param recipe The recipe.
   * @param recordedMemberId The member the recording came from; already done.
   */
  async function runRecipe(recipe: Recipe, recordedMemberId: string) {
    const targets = findRunTargets(recipe, recordedMemberId);
    stopRequested.current = false;
    let changedCount = 0;
    let failedStepCount = 0;

    for (const [index, member] of targets.entries()) {
      if (stopRequested.current) break;
      setRunState({ phase: "running", member, index, total: targets.length, stopping: false });
      // Fresh snapshot per row, so refs and current values are never stale.
      for (const step of plan(recipe, member, agent.snapshot(), memberIdOfRef)) {
        if (stopRequested.current) break;
        const result = step.ref && (await agent.act({ steps: [{ ref: step.ref, action: step.action, args: step.args }] }));
        if (!result || !result.ok) failedStepCount++;
        await new Promise((resolve) => setTimeout(resolve, stepPauseMs));
      }
      changedCount++;
    }

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

  return { runState, runRecipe, stopRun, resetRunner };
}

export { findRunTargets, useRunner };
export type { RunState };
