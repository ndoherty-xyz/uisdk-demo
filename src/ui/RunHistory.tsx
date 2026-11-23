import type { HistoryEntry } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";
import { createVirtualizer } from "@ui-sdk/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { history, memberIdOfEntry } from "../bridge";
import { fieldIdOfLabel, fields } from "../data/fields";
import { memberById } from "../data/members";
import { playSound } from "../sounds/sounds";
import { entryStatus, type EntryStatus, type HistoryView, type KeptEntry } from "../run/revert";
import {
  clearRuns,
  putBackEntries,
  readHistoryView,
  readRunStore,
  subscribeRunStore,
  undoEntries,
  type RunTurn,
} from "../run/runStore";
import { format } from "./format";

// Pieces ----------

/**
 * Function to outline a change's table cell while its line is hovered or focused.
 * @param ref The control's ref.
 * @param isHighlighted Whether to add or remove the outline.
 */
function highlightControl(ref: string, isHighlighted: boolean) {
  // A select's element is its visually hidden label, so outline the cell. Undefined once the row scrolled away.
  (elementOf(ref) as HTMLElement | undefined)?.closest("td")!.toggleAttribute("data-highlight", isHighlighted);
}

/**
 * Function to render one change as a chip: "Role Viewer → Editor", with a way to remove it, or to
 * put it back once removed.
 * @param props.entry The agent's history entry.
 * @param props.status Whether it's applied, undone or changed since.
 * @param props.onRemove Reverts just this change.
 * @param props.onPutBack Re-applies just this change.
 * @returns The chip.
 */
function ChangeChip({
  entry,
  status,
  onRemove,
  onPutBack,
}: {
  entry: HistoryEntry;
  status: EntryStatus;
  onRemove: () => void;
  onPutBack: () => void;
}) {
  const fieldId = fieldIdOfLabel(entry.label);
  return (
    <li
      className="change-chip"
      data-removed={status === "undone" || undefined}
      onPointerEnter={() => highlightControl(entry.ref, true)}
      onPointerLeave={() => highlightControl(entry.ref, false)}
      onFocus={() => highlightControl(entry.ref, true)}
      onBlur={() => highlightControl(entry.ref, false)}
    >
      <span className="change-chip-text">
        {fields[fieldId].label} <span className="muted">{format(fieldId, entry.previous)} →</span>{" "}
        {format(fieldId, entry.value)}
      </span>
      {status === "superseded" && <span className="muted">changed since</span>}
      {status === "applied" && (
        <button type="button" className="icon-button" aria-label="Remove" onClick={onRemove}>
          ×
        </button>
      )}
      {status === "undone" && (
        <button type="button" className="link-button" onClick={onPutBack}>
          Put back
        </button>
      )}
    </li>
  );
}

/**
 * Function to describe a change that undo or put back left alone because something changed it afterwards.
 * @param keptEntry The agent's entry that stayed and what replaced it.
 * @param after What the person's change came after: "the agent" or "the undo".
 * @returns e.g. "Kept Deploy alerts for Jonah Park: you changed it after the agent."
 */
function describeKept({ kept, supersededBy }: KeptEntry, after: string): string {
  const reason = supersededBy.source === "agent" ? "the agent changed it again later" : `you changed it after ${after}`;
  return `Kept ${kept.label} for ${memberById.get(memberIdOfEntry(kept))!.name}: ${reason}.`;
}

// Turns ----------

/**
 * Function to render a run's rows, newest first: a chip per change with a way to remove it, and
 * undo per row. Virtualized, since a run can touch hundreds of rows.
 * @param props.turns The run's turns, oldest first.
 * @param props.historyView The table's history, to tell each change's status.
 * @param props.onRemoveEntry Reverts one change.
 * @param props.onPutBackEntry Re-applies one removed change.
 * @param props.onUndoTurn Undoes one row.
 * @returns The list.
 */
function RunTurnList({
  turns,
  historyView,
  onRemoveEntry,
  onPutBackEntry,
  onUndoTurn,
}: {
  turns: RunTurn[];
  historyView: HistoryView;
  onRemoveEntry: (entry: HistoryEntry) => void;
  onPutBackEntry: (entry: HistoryEntry) => void;
  onUndoTurn: (turn: RunTurn) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Newest first, read by the virtualizer whenever it updates.
  const newestTurnsRef = useRef<RunTurn[]>([]);
  newestTurnsRef.current = turns.toReversed();
  const [turnsVirtualizer] = useState(() =>
    createVirtualizer({
      count: () => newestTurnsRef.current.length,
      estimate: () => 64,
      key: (index) => newestTurnsRef.current[index]!.member.id,
    }),
  );
  const virtualItems = useSyncExternalStore(turnsVirtualizer.subscribe, turnsVirtualizer.items);
  useEffect(() => turnsVirtualizer.connect(scrollerRef.current!), [turnsVirtualizer]);
  useEffect(() => turnsVirtualizer.refresh(), [turnsVirtualizer, turns]);

  return (
    <div className="run-turns-scroller" ref={scrollerRef}>
      <ol className="run-turns" style={{ height: turnsVirtualizer.size() }}>
        {virtualItems.map((item) => {
          const turn = newestTurnsRef.current[item.index]!;
          return (
            <li
              key={item.key}
              className="run-turn"
              ref={(element) => turnsVirtualizer.measure(item.index, element)}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <div className="run-turn-header">
                <strong>{turn.member.name}</strong>
                <button type="button" className="link-button" onClick={() => onUndoTurn(turn)}>
                  Undo row
                </button>
              </div>
              <ul className="change-chips">
                {turn.entries.map((entry) => (
                  <ChangeChip
                    key={entry.id}
                    entry={entry}
                    status={entryStatus(entry, historyView)}
                    onRemove={() => onRemoveEntry(entry)}
                    onPutBack={() => onPutBackEntry(entry)}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// History ----------

/**
 * Function to render every agent run so far as a card, newest first. Opening one lists the rows it
 * changed, with undo for a change, a row or the whole run, and put back for a removed change.
 * @param props.isRunning Whether the newest run is still going, so it can't be undone yet.
 * @returns The history, or nothing before the first run.
 */
function RunHistory({ isRunning }: { isRunning: boolean }) {
  const { runs, undoneEntryIds } = useSyncExternalStore(subscribeRunStore, readRunStore);
  // Any table change can supersede a chip, so re-render on every history move.
  useSyncExternalStore(history.subscribe, history.position);
  const historyView = readHistoryView();
  const [keptMessages, setKeptMessages] = useState<string[]>([]);
  const [openedRunStart, setOpenedRunStart] = useState<number | null>(null);

  /**
   * Function to undo some agent entries and report what was kept.
   * @param entries The entries, oldest first.
   */
  async function undoAndReport(entries: HistoryEntry[]) {
    playSound.undo();
    setKeptMessages([]);
    const keptEntries = await undoEntries(entries);
    setKeptMessages(keptEntries.map((keptEntry) => describeKept(keptEntry, "the agent")));
  }

  /**
   * Function to put one removed change back and report if it was kept instead.
   * @param entry The agent's entry.
   */
  async function putBackAndReport(entry: HistoryEntry) {
    setKeptMessages([]);
    const keptEntries = await putBackEntries([entry]);
    setKeptMessages(keptEntries.map((keptEntry) => describeKept(keptEntry, "the undo")));
  }

  if (runs.length === 0) return null;
  const openedRun = runs.find((run) => run.startedAt === openedRunStart);

  if (openedRun) {
    const isOpenedRunGoing = isRunning && openedRun === runs.at(-1);
    return (
      <section key="run" className="run-history" data-depth="run" aria-label="Agent run">
        <header className="run-history-header">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOpenedRunStart(null);
              setKeptMessages([]);
            }}
          >
            ← Runs
          </button>
          <button
            type="button"
            className="button"
            disabled={isOpenedRunGoing}
            onClick={() => undoAndReport(openedRun.turns.flatMap((turn) => turn.entries))}
          >
            Undo run
          </button>
        </header>
        <h3 className="run-title">
          {openedRun.title}{" "}
          <span className="muted">
            · {openedRun.turns.length.toLocaleString()} {openedRun.turns.length === 1 ? "person" : "people"}
          </span>
        </h3>
        {keptMessages.length > 0 && (
          <ul className="run-kept" role="status">
            {keptMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <RunTurnList
          turns={openedRun.turns}
          historyView={historyView}
          onRemoveEntry={(entry) => undoAndReport([entry])}
          onPutBackEntry={putBackAndReport}
          onUndoTurn={(turn) => undoAndReport(turn.entries)}
        />
      </section>
    );
  }

  return (
    <section key="runs" className="run-history" data-depth="runs" aria-label="Agent runs">
      <header className="run-history-header">
        <h3>Runs</h3>
        <button type="button" className="link-button" disabled={isRunning} onClick={clearRuns}>
          Clear
        </button>
      </header>
      <ol className="run-cards">
        {runs.toReversed().map((run) => {
          const entries = run.turns.flatMap((turn) => turn.entries);
          const undoneCount = entries.filter((entry) => undoneEntryIds.has(entry.id)).length;
          const isGoing = isRunning && run === runs.at(-1);
          return (
            <li key={run.startedAt}>
              <button type="button" className="run-card" onClick={() => setOpenedRunStart(run.startedAt)}>
                <span className="run-card-title">
                  <strong>{run.title}</strong>
                  <span className="muted">
                    {new Date(run.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="muted">
                  {run.recipe
                    ? run.recipe.steps
                        .map((step) => `${fields[step.field].label} → ${format(step.field, step.value)}`)
                        .join(", ")
                    : `${entries.length} ${entries.length === 1 ? "change" : "changes"}`}
                </span>
                <span className="run-card-status">
                  {isGoing ? "Running · " : ""}
                  {run.turns.length.toLocaleString()} {run.turns.length === 1 ? "person" : "people"}
                  {undoneCount > 0 &&
                    (undoneCount === entries.length
                      ? " · undone"
                      : ` · ${undoneCount} of ${entries.length} changes undone`)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { RunHistory };
