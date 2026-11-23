import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { fieldIdOfLabel, fields, type FieldId } from "../data/fields";
import { memberById, members, type Member, type Team } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { previewRecipe } from "../preview/usePreview";
import type { Recipe } from "../recipe/schema";
import { addRunTurn, readRunStore, startRun, undoEntries } from "../run/runStore";
import { findRunTargets } from "../run/useRunner";
import { format } from "../ui/format";
import { flashChangedCell, hideGhostCursor, moveGhostCursor } from "../ui/GhostCursor";
import { readTableQuery, readVisibleMembers, scrollToMember, setTableQuery } from "../ui/tableVirtualizer";

// What each voice tool does in the page. Every handler returns compact JSON and never throws.

/** The runner's actions, from `useRunner`. */
type Runner = {
  runRecipe: (recipe: Recipe) => Promise<{ changedCount: number; failedStepCount: number; stopped: boolean }>;
  stopRun: () => void;
};

/** The voice request being worked on: what the person said, and whether its changes have a run yet. */
type VoiceRequest = { utterance: string; hasRun: boolean };

type ToolResult = Record<string, unknown>;

const glideMs = 300;

// Lookups ----------

/**
 * Function to turn a spoken value into a field's value: an option by value or label, or on/off.
 * @param fieldId The field.
 * @param text e.g. "Editor", "admin", "on", "off".
 * @returns The value, or undefined if it isn't one of the field's.
 */
function parseFieldValue(fieldId: FieldId, text: string): string | boolean | undefined {
  const field = fields[fieldId];
  const spoken = text.trim().toLowerCase();
  if (field.kind === "switch") {
    if (["on", "true", "yes", "enabled"].includes(spoken)) return true;
    if (["off", "false", "no", "disabled"].includes(spoken)) return false;
    return undefined;
  }
  return field.options.find(([value, label]) => value === spoken || label.toLowerCase() === spoken)?.[0];
}

/**
 * Function to find people by full or partial name.
 * @param name What the person said, e.g. "Jonah" or "jonah park".
 * @returns An exact full-name match alone, else everyone whose name contains it.
 */
function findMembersByName(name: string): Member[] {
  const spoken = name.trim().toLowerCase();
  const exact = members.filter((member) => member.name.toLowerCase() === spoken);
  return exact.length > 0 ? exact : members.filter((member) => member.name.toLowerCase().includes(spoken));
}

/**
 * Function to describe a person and their settings for the model.
 * @param member The person.
 * @returns Their name, team, location and formatted settings.
 */
function describeMember(member: Member) {
  const settings = readSettings(member.id);
  return {
    name: member.name,
    team: member.team,
    location: member.location,
    ...Object.fromEntries(Object.entries(settings).map(([fieldId, value]) => [fieldId, format(fieldId as FieldId, value)])),
  };
}

// Tools ----------

/**
 * Function to filter the table, replacing the current filters.
 * @param args The team, location and search text, each null to clear.
 * @returns How many are shown and up to 10 of them.
 */
function showPeople(args: { team: string | null; location: string | null; search: string | null }): ToolResult {
  setTableQuery({ ...readTableQuery(), team: args.team as Team | null, location: args.location, search: args.search ?? "" });
  const shownMembers = readVisibleMembers();
  return { shown: shownMembers.length, people: shownMembers.slice(0, 10).map(describeMember) };
}

/**
 * Function to change one setting for one person: scroll to their row, glide the cursor there, and act.
 * @param args The person's name, the field and the spoken value.
 * @param request The voice request this change belongs to.
 * @returns What changed, or why nothing did.
 */
async function setSetting(
  args: { person: string; field: string; value: string },
  request: VoiceRequest,
): Promise<ToolResult> {
  if (!(args.field in fields)) return { error: `unknown field ${args.field}` };
  const fieldId = args.field as FieldId;
  const value = parseFieldValue(fieldId, args.value);
  if (value === undefined) return { error: `${args.value} isn't a value for ${fieldId}` };
  const found = findMembersByName(args.person);
  if (found.length === 0) return { error: `no one named ${args.person}` };
  if (found.length > 1) return { error: "more than one match", matches: found.slice(0, 5).map((member) => member.name) };
  const member = found[0]!;
  const previous = readSettings(member.id)[fieldId];
  if (previous === value) return { person: member.name, field: fieldId, unchanged: format(fieldId, value) };

  if (!request.hasRun) {
    startRun(request.utterance ? `“${request.utterance}”` : "Voice request");
    request.hasRun = true;
  }
  await scrollToMember(member.id, glideMs);
  const control = (await queryMemberControls(member.name, member.id)).find(
    (component) => component.label === fields[fieldId].label,
  );
  if (!control) return { error: `couldn't find ${member.name}'s ${fieldId} control` };
  const turnStart = history.position();
  await moveGhostCursor(control.ref, glideMs);
  const result = await agent.act({
    steps: [{ ref: control.ref, action: fields[fieldId].kind === "switch" ? "setChecked" : "setValue", args: [value] }],
  });
  hideGhostCursor();
  if (result.error) return { error: `couldn't change ${member.name}'s ${fieldId}` };
  flashChangedCell(control.ref);
  addRunTurn({ member, entries: history.entries().slice(turnStart).filter((entry) => entry.source === "agent") });
  return { person: member.name, field: fieldId, from: format(fieldId, previous), to: format(fieldId, value) };
}

/**
 * Function to preview or apply changes to everyone the table shows.
 * @param args The changes and whether the person confirmed.
 * @param runner The runner, for confirmed runs.
 * @returns Counts for a preview, or the run's result.
 */
async function changeShown(
  args: { changes: { field: string; value: string }[]; confirm: boolean },
  runner: Runner,
): Promise<ToolResult> {
  const steps: Recipe["steps"] = [];
  for (const change of args.changes) {
    if (!(change.field in fields)) return { error: `unknown field ${change.field}` };
    const value = parseFieldValue(change.field as FieldId, change.value);
    if (value === undefined) return { error: `${change.value} isn't a value for ${change.field}` };
    steps.push({ field: change.field, value } as Recipe["steps"][number]);
  }
  const { team, location, search } = readTableQuery();
  const audience = [team, location && `in ${location}`, search && `matching “${search}”`].filter(Boolean).join(" ");
  const recipe: Recipe = { reasoning: "", audience: audience || "everyone", filter: null, steps };
  const targets = findRunTargets(recipe);
  if (!args.confirm) {
    previewRecipe(recipe);
    return { shown: readVisibleMembers().length, willChange: targets.length, alreadySet: readVisibleMembers().length - targets.length };
  }
  if (targets.length === 0) return { changed: 0, note: "everyone shown already has these values" };
  return runner.runRecipe(recipe);
}

/**
 * Function to undo the newest run's changes, except some fields.
 * @param args The fields to keep.
 * @returns How many changes were undone and which were kept, with why.
 */
async function undoLastTurn(args: { except_fields: string[] }): Promise<ToolResult> {
  const newestRun = readRunStore().runs.at(-1);
  if (!newestRun) return { error: "nothing to undo" };
  const entries = newestRun.turns
    .flatMap((turn) => turn.entries)
    .filter((entry) => !args.except_fields.includes(fieldIdOfLabel(entry.label)));
  const undoneBefore = readRunStore().undoneEntryIds;
  const keptEntries = await undoEntries(entries);
  const { undoneEntryIds } = readRunStore();
  return {
    request: newestRun.title,
    undone: entries.filter((entry) => undoneEntryIds.has(entry.id) && !undoneBefore.has(entry.id)).length,
    kept: keptEntries.map(({ kept, supersededBy }) => ({
      person: memberById.get(memberIdOfEntry(kept))!.name,
      field: fieldIdOfLabel(kept.label),
      why: supersededBy.source === "agent" ? "the agent changed it again later" : "the person changed it after the agent",
    })),
  };
}

/**
 * Function to run one voice tool call.
 * @param name The tool's name.
 * @param argumentsJson Its arguments as JSON.
 * @param request The voice request it belongs to.
 * @param runner The runner, for recipe runs.
 * @returns The tool's result; errors come back as `{ error }`.
 */
async function runVoiceTool(name: string, argumentsJson: string, request: VoiceRequest, runner: Runner): Promise<ToolResult> {
  try {
    const args = JSON.parse(argumentsJson);
    // A preview lasts until the next tool call.
    previewRecipe(null);
    if (name === "show_people") return showPeople(args);
    if (name === "set_setting") return await setSetting(args, request);
    if (name === "change_shown") return await changeShown(args, runner);
    if (name === "undo_last_turn") return await undoLastTurn(args);
    if (name === "stop") {
      runner.stopRun();
      return { stopping: true };
    }
    return { error: `unknown tool ${name}` };
  } catch (error) {
    hideGhostCursor();
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export { runVoiceTool };
export type { Runner, VoiceRequest };
