import type { HistoryEntry } from "@ui-sdk/react/history";
import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { fieldIdOfLabel, fields, type FieldId } from "../data/fields";
import { memberById, members, type Member, type Team } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { previewRecipe } from "../preview/usePreview";
import type { Recipe } from "../recipe/schema";
import { entryStatus, type KeptEntry } from "../run/revert";
import {
  addRunTurn,
  putBackEntries,
  readHistoryView,
  readRunStore,
  startRun,
  undoEntries,
} from "../run/runStore";
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
 * @returns An exact full-name match alone, else everyone whose name contains it, else everyone
 * with that first name (transcripts often mishear surnames).
 */
function findMembersByName(name: string): Member[] {
  const spoken = name.trim().toLowerCase();
  const exact = members.filter((member) => member.name.toLowerCase() === spoken);
  if (exact.length > 0) return exact;
  const containing = members.filter((member) => member.name.toLowerCase().includes(spoken));
  if (containing.length > 0) return containing;
  const firstName = spoken.split(" ")[0]!;
  return members.filter((member) => member.name.toLowerCase().split(" ")[0] === firstName);
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

/** Short ids for history entries ("h1"), so the model can name a change. */
const shortIdOfEntryId = new Map<string, string>();

/**
 * Function to get an entry's short id, giving it the next one on first sight.
 * @param entry The history entry.
 * @returns e.g. "h12".
 */
function shortIdOfEntry(entry: HistoryEntry): string {
  if (!shortIdOfEntryId.has(entry.id)) shortIdOfEntryId.set(entry.id, `h${shortIdOfEntryId.size + 1}`);
  return shortIdOfEntryId.get(entry.id)!;
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
 * @param args The changes, people to leave out, and whether the person confirmed.
 * @param runner The runner, for confirmed runs.
 * @returns Counts for a preview, or the run's result.
 */
async function changeShown(
  args: { changes: { field: string; value: string }[]; exclude_people: string[]; confirm: boolean },
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
  const excludedNames = args.exclude_people.flatMap((name) => findMembersByName(name).map((member) => member.name));
  const recipe: Recipe = {
    reasoning: "",
    audience: [audience || "everyone", excludedNames.length > 0 && `except ${excludedNames.join(", ")}`].filter(Boolean).join(" "),
    filter: excludedNames.length > 0 ? { all: excludedNames.map((name) => ({ attr: "name", op: "neq", value: name })) } : null,
    steps,
  };
  const targets = findRunTargets(recipe);
  if (!args.confirm) {
    previewRecipe(recipe);
    return { shown: readVisibleMembers().length, willChange: targets.length, ...(excludedNames.length > 0 && { excluded: excludedNames }) };
  }
  if (targets.length === 0) return { changed: 0, note: "everyone shown already has these values" };
  return runner.runRecipe(recipe);
}

/**
 * Function to explain why an undo or put back left an entry alone, for the voice.
 * @param keptEntry The kept entry and what changed it afterwards.
 * @returns Who, which field, and why.
 */
function describeKeptEntry({ kept, supersededBy }: KeptEntry) {
  return {
    id: shortIdOfEntry(kept),
    person: memberById.get(memberIdOfEntry(kept))!.name,
    field: fieldIdOfLabel(kept.label),
    why:
      supersededBy.source !== "agent"
        ? "the person changed it after the agent"
        : readRunStore().undoEntryIds.has(supersededBy.id)
          ? "an undo changed it after"
          : "the agent changed it again later",
  };
}

/**
 * Function to list changes to the table, newest first, with ids the model can undo by.
 * @param args Optional person, field and turn ("last", "t3") to narrow to.
 * @returns Up to 30 changes and the last 5 requests.
 */
function listChanges(args: { person: string | null; field: string | null; turn: string | null }): ToolResult {
  const historyView = readHistoryView();
  const { runs, undoEntryIds } = readRunStore();
  const turnOfEntryId = new Map(
    runs.flatMap((run, index) => run.turns.flatMap((turn) => turn.entries.map((entry) => [entry.id, `t${index + 1}`]))),
  );
  const turn = args.turn === "last" ? `t${runs.length}` : args.turn;
  const personIds = args.person ? new Set(findMembersByName(args.person).map((member) => member.id)) : null;
  const changes = historyView.entries
    .slice(0, historyView.position)
    // Undo's own entries show up as their original's "undone" status instead.
    .filter((entry) => !undoEntryIds.has(entry.id))
    .filter((entry) => !personIds || personIds.has(memberIdOfEntry(entry)))
    .filter((entry) => !args.field || fieldIdOfLabel(entry.label) === args.field)
    .filter((entry) => !turn || turnOfEntryId.get(entry.id) === turn)
    .reverse()
    .slice(0, 30)
    .map((entry) => {
      const fieldId = fieldIdOfLabel(entry.label);
      return {
        id: shortIdOfEntry(entry),
        turn: turnOfEntryId.get(entry.id),
        who: entry.source === "agent" ? "agent" : "person",
        person: memberById.get(memberIdOfEntry(entry))!.name,
        field: fieldId,
        from: format(fieldId, entry.previous),
        to: format(fieldId, entry.value),
        status: entryStatus(entry, historyView),
      };
    });
  const turns = runs
    .map((run, index) => ({ id: `t${index + 1}`, request: run.title, changes: run.turns.flatMap((t) => t.entries).length }))
    .slice(-5);
  return { changes, turns };
}

/**
 * Function to undo or put back the agent's changes, then report each one's result.
 * @param entries The agent's entries, oldest first.
 * @param direction "undo" to take them back, "putBack" to re-apply undone ones.
 * @returns How many changed, and which were kept or skipped, with why.
 */
async function revertEntries(entries: HistoryEntry[], direction: "undo" | "putBack"): Promise<ToolResult> {
  const undoneBefore = readRunStore().undoneEntryIds;
  const isPending = (entry: HistoryEntry) => (direction === "undo" ? !undoneBefore.has(entry.id) : undoneBefore.has(entry.id));
  const keptEntries = direction === "undo" ? await undoEntries(entries) : await putBackEntries(entries);
  const { undoneEntryIds } = readRunStore();
  const changedCount = entries.filter(
    (entry) => isPending(entry) && (direction === "undo" ? undoneEntryIds.has(entry.id) : !undoneEntryIds.has(entry.id)),
  ).length;
  const skipped = entries
    .filter((entry) => !isPending(entry))
    .map((entry) => ({ id: shortIdOfEntry(entry), why: direction === "undo" ? "already undone" : "not undone" }));
  return {
    [direction === "undo" ? "undone" : "putBack"]: changedCount,
    ...(keptEntries.length > 0 && { kept: keptEntries.map(describeKeptEntry) }),
    ...(skipped.length > 0 && { skipped }),
  };
}

/**
 * Function to undo or put back specific changes by their list_changes ids.
 * @param args The ids.
 * @param direction "undo" or "putBack".
 * @returns The result, plus any ids that aren't the agent's changes.
 */
async function revertChangesById(args: { ids: string[] }, direction: "undo" | "putBack"): Promise<ToolResult> {
  const { undoEntryIds } = readRunStore();
  const entryIdOfShortId = new Map([...shortIdOfEntryId].map(([entryId, shortId]) => [shortId, entryId]));
  const wantedEntryIds = new Set(args.ids.map((id) => entryIdOfShortId.get(id)));
  const entries = history
    .entries()
    .filter((entry) => wantedEntryIds.has(entry.id) && entry.source === "agent" && !undoEntryIds.has(entry.id));
  const unknownIds = args.ids.filter((id) => !entries.some((entry) => shortIdOfEntry(entry) === id));
  return { ...(await revertEntries(entries, direction)), ...(unknownIds.length > 0 && { notAgentChanges: unknownIds }) };
}

/**
 * Function to undo one request's changes, or every request's, except some fields or people.
 * @param args The turn ("last", "all", "t3") and what to keep.
 * @returns How many changes were undone and which were kept, with why.
 */
async function undoTurn(args: { turn: string; except_fields: string[]; except_people: string[] }): Promise<ToolResult> {
  const { runs } = readRunStore();
  const runIndex = args.turn === "last" ? runs.length - 1 : Number(args.turn.slice(1)) - 1;
  const undoneRuns = args.turn === "all" ? runs : runs.slice(runIndex, runIndex + 1);
  if (undoneRuns.length === 0) return { error: "nothing to undo" };
  const keptPersonIds = new Set(args.except_people.flatMap((name) => findMembersByName(name).map((member) => member.id)));
  const entries = undoneRuns
    .flatMap((run) => run.turns)
    .filter((turn) => !keptPersonIds.has(turn.member.id))
    .flatMap((turn) => turn.entries)
    .filter((entry) => !args.except_fields.includes(fieldIdOfLabel(entry.label)));
  return { request: args.turn === "all" ? "all requests" : undoneRuns[0]!.title, ...(await revertEntries(entries, "undo")) };
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
    if (name === "list_changes") return listChanges(args);
    if (name === "undo_changes") return await revertChangesById(args, "undo");
    if (name === "put_back_changes") return await revertChangesById(args, "putBack");
    if (name === "undo_turn") return await undoTurn(args);
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
