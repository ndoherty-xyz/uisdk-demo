import { stageChanges } from "@ui-sdk/react/history";
import { useSyncExternalStore } from "react";
import { agent, history, memberIdOfRef, readSettingsByMember } from "../bridge";
import { fields, type Settings } from "../data/fields";
import { members } from "../data/members";
import { matches } from "../recipe/evaluate";
import { plan, type PlannedStep } from "../recipe/plan";
import type { Recipe } from "../recipe/schema";

/**
 * Stage and revert entries from previews. Recordings (person entries only) skip them already; the
 * superseded rule needs this to skip them too.
 */
const previewEntryIds = new Set<string>();

/** Staged steps by member id; empty when nothing is previewed. */
type StagedSteps = Map<string, PlannedStep[]>;

const previewDelayMs = 120;

// One preview for the whole page, so this is module state, not component state.
let stagedSteps: StagedSteps = new Map();
let stagedHandle: Awaited<ReturnType<typeof stageChanges>> | null = null;
let previewedRecipe: { recipe: Recipe; recordedMemberId: string } | null = null;
// Staging and reverting run strictly in order, so rapid recipe edits never leave stale values behind.
let previewQueue = Promise.resolve();
let delayTimer: ReturnType<typeof setTimeout> | undefined;
const previewListeners = new Set<() => void>();

/**
 * Function to set the staged steps and tell subscribers.
 * @param steps The new staged steps.
 */
function setStagedSteps(steps: StagedSteps) {
  stagedSteps = steps;
  for (const listener of previewListeners) listener();
}

/**
 * Function to run a stage or revert and add the agent entries it made to `previewEntryIds`.
 * @param stageOrRevert The call that changes controls.
 * @returns What the call returned.
 */
async function rememberPreviewEntries<T>(stageOrRevert: () => Promise<T>): Promise<T> {
  const start = history.position();
  const result = await stageOrRevert();
  for (const entry of history.entries().slice(start)) {
    if (entry.source === "agent") previewEntryIds.add(entry.id);
  }
  return result;
}

/**
 * Function to put every staged row back, if any.
 * @returns When the revert has finished.
 */
async function revertStagedRows() {
  const handle = stagedHandle;
  stagedHandle = null;
  await rememberPreviewEntries(async () => handle?.revert());
  if (stagedSteps.size > 0) setStagedSteps(new Map());
}

/**
 * Function to stage the previewed recipe on every row it would change.
 * @returns When staging has finished.
 */
async function stagePreviewedRecipe() {
  if (!previewedRecipe) return;
  const { recipe, recordedMemberId } = previewedRecipe;
  const snapshot = agent.snapshot();
  const steps: StagedSteps = new Map();
  for (const member of members) {
    if (member.id === recordedMemberId || !matches(recipe, member)) continue;
    const memberSteps = plan(recipe, member, snapshot, memberIdOfRef).filter((step) => step.ref);
    if (memberSteps.length > 0) steps.set(member.id, memberSteps);
  }
  // Set before staging, so readSettingsWithoutPreview never mistakes staged values for real ones.
  setStagedSteps(steps);
  stagedHandle = await rememberPreviewEntries(() =>
    stageChanges(
      agent,
      [...steps.values()].flat().map((step) => ({ ref: step.ref!, key: fields[step.field].key, value: step.args[0] })),
    ),
  );
}

// Actions ----------

/** Function to revert the preview and stage it again from current values, after a short delay. */
function restagePreview() {
  clearTimeout(delayTimer);
  delayTimer = setTimeout(() => {
    previewQueue = previewQueue.then(revertStagedRows).then(stagePreviewedRecipe);
  }, previewDelayMs);
}

// A person's edit can change which rows the recipe would touch.
history.subscribe(() => {
  if (previewedRecipe && history.entries().at(-1)?.source !== "agent") restagePreview();
});

/**
 * Function to preview a recipe on every row it would change, replacing any earlier preview after a
 * short delay. Null stops previewing.
 * @param recipe The recipe, or null.
 * @param recordedMemberId The member the recording came from; already has the values.
 */
function previewRecipe(recipe: Recipe | null, recordedMemberId: string) {
  previewedRecipe = recipe && { recipe, recordedMemberId };
  restagePreview();
}

/**
 * Function to revert the preview now, keeping the recipe so `restagePreview` can bring it back.
 * @returns When the revert has finished.
 */
function revertPreview(): Promise<void> {
  clearTimeout(delayTimer);
  previewQueue = previewQueue.then(revertStagedRows);
  return previewQueue;
}

// Reading ----------

/**
 * Function to read every member's settings as they really are, with any staged rows undone.
 * @returns Settings by member id.
 */
function readSettingsWithoutPreview(): Map<string, Settings> {
  const settingsByMember = readSettingsByMember();
  for (const [memberId, steps] of stagedSteps) {
    for (const step of steps) Object.assign(settingsByMember.get(memberId)!, { [step.field]: step.before });
  }
  return settingsByMember;
}

/**
 * Function to subscribe a component to the staged rows.
 * @returns Staged steps by member id.
 */
function usePreview(): StagedSteps {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    () => stagedSteps,
  );
}

export { previewEntryIds, previewRecipe, readSettingsWithoutPreview, revertPreview, usePreview };
