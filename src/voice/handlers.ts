import type { HistoryEntry } from "@ui-sdk/react/history";
import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { fieldIdOfLabel, fields, type FieldId } from "../data/fields";
import { memberById, members, type Member, type Team } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { previewRecipe } from "../preview/usePreview";
import type { Clause, Recipe } from "../recipe/schema";
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

/** Changes to this many people or fewer run without a preview. */
const autoRunMaxCount = 10;

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
 * Function to parse spoken field/value pairs into field values.
 * @param pairs e.g. `[{ field: "role", value: "Editor" }]`.
 * @returns The parsed pairs, or an error naming the first bad one.
 */
function parseFieldValues(pairs: { field: string; value: string }[]) {
  const parsed: { field: FieldId; value: string | boolean }[] = [];
  for (const pair of pairs) {
    if (!(pair.field in fields)) return { error: `unknown field ${pair.field}` };
    const value = parseFieldValue(pair.field as FieldId, pair.value);
    if (value === undefined) return { error: `${pair.value} isn't a value for ${pair.field}` };
    parsed.push({ field: pair.field as FieldId, value });
  }
  return { parsed };
}

/**
 * Function to preview or apply changes to everyone the table shows.
 * @param args The changes, current values to narrow to, people to leave out, and whether the person confirmed.
 * @param runner The runner, for confirmed or small runs.
 * @returns Counts for a preview, or the run's result.
 */
async function changeShown(
  args: {
    changes: { field: string; value: string }[];
    only_where: { field: string; value: string }[];
    exclude_people: string[];
    confirm: boolean;
  },
  runner: Runner,
): Promise<ToolResult> {
  const changes = parseFieldValues(args.changes);
  if (changes.error) return { error: changes.error };
  const onlyWhere = parseFieldValues(args.only_where);
  if (onlyWhere.error) return { error: onlyWhere.error };
  const excludedNames = args.exclude_people.flatMap((name) => findMembersByName(name).map((member) => member.name));

  const { team, location, search } = readTableQuery();
  const audience = [
    team ?? "everyone",
    location && `in ${location}`,
    search && `matching “${search}”`,
    onlyWhere.parsed!.length > 0 && `with ${onlyWhere.parsed!.map(({ field, value }) => format(field, value)).join(", ")}`,
    excludedNames.length > 0 && `except ${excludedNames.join(", ")}`,
  ];
  const clauses: Clause[] = [
    ...onlyWhere.parsed!.map(({ field, value }) => ({ attr: field, op: "eq" as const, value: String(value) })),
    ...excludedNames.map((name) => ({ attr: "name" as const, op: "neq" as const, value: name })),
  ];
  const recipe: Recipe = {
    reasoning: "",
    audience: audience.filter(Boolean).join(" "),
    filter: clauses.length > 0 ? { all: clauses } : null,
    steps: changes.parsed! as Recipe["steps"],
  };
  const targets = findRunTargets(recipe);
  // Small changes run without asking; undo is one sentence away.
  if (!args.confirm && targets.length > autoRunMaxCount) {
    previewRecipe(recipe);
    return { shown: readVisibleMembers().length, willChange: targets.length, ...(excludedNames.length > 0 && { excluded: excludedNames }) };
  }
  if (targets.length === 0) return { changed: 0, note: "no one shown needs these changes" };
  return runner.runRecipe(recipe);
}

/**
 * Function to copy the person's latest hand edits on one row to everyone else shown.
 * @param args People to leave out and whether the person confirmed.
 * @param runner The runner, for confirmed or small runs.
 * @returns Whose row and which values were copied, plus the preview or run result.
 */
async function copyMyChanges(args: { exclude_people: string[]; confirm: boolean }, runner: Runner): Promise<ToolResult> {
  const personEntries = history
    .entries()
    .slice(0, history.position())
    .filter((entry) => entry.source !== "agent");
  const newestEntry = personEntries.at(-1);
  if (!newestEntry) return { error: "the person hasn't changed anything by hand" };
  const member = memberById.get(memberIdOfEntry(newestEntry))!;
  // The newest value per field on that row, if it's still the current value.
  const valueOfField = new Map(
    personEntries
      .filter((entry) => memberIdOfEntry(entry) === member.id)
      .map((entry) => [fieldIdOfLabel(entry.label), entry.value as string | boolean]),
  );
  const settings = readSettings(member.id);
  const changes = [...valueOfField]
    .filter(([fieldId, value]) => settings[fieldId] === value)
    .map(([fieldId, value]) => ({ field: fieldId, value: format(fieldId, value) }));
  const result = await changeShown(
    { changes, only_where: [], exclude_people: [member.name, ...args.exclude_people], confirm: args.confirm },
    runner,
  );
  return { copiedFrom: member.name, changes, ...result };
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
 * @param args Optional person, field, turn ("last", "t3") and who made it, to narrow to.
 * @returns Up to 30 changes and the last 5 requests.
 */
function listChanges(args: {
  person: string | null;
  field: string | null;
  turn: string | null;
  who: "agent" | "person" | null;
}): ToolResult {
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
    .filter((entry) => !args.who || (entry.source === "agent") === (args.who === "agent"))
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
    if (name === "copy_my_changes") return await copyMyChanges(args, runner);
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
