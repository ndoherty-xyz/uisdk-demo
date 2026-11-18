import type { HistoryEntry } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";
import { createVirtualizer } from "@ui-sdk/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { fieldIdOfLabel, fields } from "../data/fields";
import { memberById, type Member } from "../data/members";
import { playSound } from "../sounds/sounds";
import { findSupersedingEntry, planUndo, type HistoryView, type KeptEntry } from "../run/revert";
import type { AgentRun, RunTurn } from "../run/useRunner";
import { format } from "./format";
import { scrollToMember } from "./tableVirtualizer";

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
 * Function to render one change as a chip: "Role Viewer → Editor", with a way to remove it.
 * @param props.entry The agent's history entry.
 * @param props.isRemoved Whether it has been reverted from the list.
 * @param props.isSuperseded Whether something changed the control after the agent.
 * @param props.onRemove Reverts just this change.
 * @returns The chip.
 */
function ChangeChip({
  entry,
  isRemoved,
  isSuperseded,
  onRemove,
}: {
  entry: HistoryEntry;
  isRemoved: boolean;
  isSuperseded: boolean;
  onRemove: () => void;
}) {
  const fieldId = fieldIdOfLabel(entry.label);
  return (
    <li
      className="change-chip"
      data-removed={isRemoved || undefined}
      onPointerEnter={() => highlightControl(entry.ref, true)}
      onPointerLeave={() => highlightControl(entry.ref, false)}
      onFocus={() => highlightControl(entry.ref, true)}
      onBlur={() => highlightControl(entry.ref, false)}
    >
      <span className="change-chip-text">
        {fields[fieldId].label} <span className="muted">{format(fieldId, entry.previous)} →</span>{" "}
        {format(fieldId, entry.value)}
      </span>
      {isSuperseded && !isRemoved ? (
        <span className="muted">changed since</span>
      ) : (
        !isRemoved && (
          <button type="button" className="icon-button" aria-label="Remove" onClick={onRemove}>
            ×
          </button>
        )
      )}
    </li>
  );
}

/**
 * Function to describe a change that undo kept because something changed it afterwards.
 * @param keptEntry The agent's entry that stayed and what replaced it.
 * @param member Whose row it is.
 * @returns e.g. "Kept Deploy alerts for Jonah Park: you changed it after the agent."
 */
function describeKept({ kept, supersededBy }: KeptEntry, member: Member): string {
  const reason =
    supersededBy.source === "agent" ? "the agent changed it again later" : "you changed it after the agent";
  return `Kept ${kept.label} for ${member.name}: ${reason}.`;
}

// Turns ----------

/**
 * Function to render a run's rows, newest first: a chip per change with a way to remove it, and
 * undo per row. Virtualized, since a run can touch hundreds of rows.
 * @param props.turns The run's turns, oldest first.
 * @param props.historyView The table's history, to tell which changes were superseded.
 * @param props.removedEntryIds Entries already reverted from the list.
 * @param props.onRemoveEntry Reverts one change.
 * @param props.onUndoTurn Undoes one row.
 * @returns The list.
 */
function RunTurnList({
  turns,
  historyView,
  removedEntryIds,
  onRemoveEntry,
  onUndoTurn,
}: {
  turns: RunTurn[];
  historyView: HistoryView;
  removedEntryIds: ReadonlySet<string>;
  onRemoveEntry: (entry: HistoryEntry) => void;
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
                    isRemoved={removedEntryIds.has(entry.id)}
                    isSuperseded={findSupersedingEntry(entry, historyView) !== undefined}
                    onRemove={() => onRemoveEntry(entry)}
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
 * changed, with undo for a change, a row or the whole run.
 * @param props.runs The runs, oldest first.
 * @param props.isRunning Whether the newest run is still going, so it can't be undone yet.
 * @param props.onClear Forgets every run without reverting anything.
 * @returns The history, or nothing before the first run.
 */
function RunHistory({ runs, isRunning, onClear }: { runs: AgentRun[]; isRunning: boolean; onClear: () => void }) {
  // Any table change can supersede a chip, so re-render on every history move.
  const position = useSyncExternalStore(history.subscribe, history.position);
  const historyView: HistoryView = { entries: history.entries(), position, memberIdOf: memberIdOfEntry };
  const [removedEntryIds, setRemovedEntryIds] = useState<ReadonlySet<string>>(new Set());
  const [keptMessages, setKeptMessages] = useState<string[]>([]);
  const [openedRunStart, setOpenedRunStart] = useState<number | null>(null);

  /**
   * Function to put entries' controls back to their previous values, a row at a time, scrolling
   * back to rows that left the screen. They count as removed from the start, so their own revert
   * entries never show them as superseded.
   * @param entries The entries to revert, in order.
   */
  async function revertEntries(entries: HistoryEntry[]) {
    setRemovedEntryIds((ids) => new Set([...ids, ...entries.map((entry) => entry.id)]));
    const entriesByMember = Map.groupBy(entries, memberIdOfEntry);
    for (const [memberId, memberEntries] of entriesByMember) {
      await scrollToMember(memberId, 0);
      // The row may have remounted with new refs, so find its controls again by label.
      const controls = await queryMemberControls(memberById.get(memberId)!.name, memberId);
      const result = await agent.act({
        steps: memberEntries.map((entry) => ({
          ref: controls.find((control) => control.label === entry.label)!.ref,
          action: entry.key === "checked" ? "setChecked" : "setValue",
          args: [entry.previous],
        })),
      });
      // act stops at the first failing step; that one and the rest stay.
      if (result.error) {
        const failedIds = new Set(memberEntries.slice(result.error.step).map((entry) => entry.id));
        setRemovedEntryIds((ids) => new Set([...ids].filter((id) => !failedIds.has(id))));
      }
    }
  }

  /**
   * Function to undo some turns' changes, newest first, and report what was kept.
   * @param undoneTurns The turns to undo.
   */
  async function undoTurns(undoneTurns: RunTurn[]) {
    const memberByEntryId = new Map(
      undoneTurns.flatMap((turn) => turn.entries.map((entry) => [entry.id, turn.member])),
    );
    const undoPlan = planUndo(
      undoneTurns.flatMap((turn) => turn.entries),
      historyView,
      removedEntryIds,
    );
    playSound.undo();
    setKeptMessages(undoPlan.keep.map((keptEntry) => describeKept(keptEntry, memberByEntryId.get(keptEntry.kept.id)!)));
    await revertEntries(undoPlan.revert);
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
            onClick={() => undoTurns(openedRun.turns)}
          >
            Undo run
          </button>
        </header>
        <h3 className="run-title">
          {openedRun.recipe.audience}{" "}
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
          removedEntryIds={removedEntryIds}
          onRemoveEntry={(entry) => revertEntries([entry])}
          onUndoTurn={(turn) => undoTurns([turn])}
        />
      </section>
    );
  }

  return (
    <section key="runs" className="run-history" data-depth="runs" aria-label="Agent runs">
      <header className="run-history-header">
        <h3>Runs</h3>
        <button type="button" className="link-button" disabled={isRunning} onClick={onClear}>
          Clear
        </button>
      </header>
      <ol className="run-cards">
        {runs.toReversed().map((run) => {
          const entries = run.turns.flatMap((turn) => turn.entries);
          const undoneCount = entries.filter((entry) => removedEntryIds.has(entry.id)).length;
          const isGoing = isRunning && run === runs.at(-1);
          return (
            <li key={run.startedAt}>
              <button type="button" className="run-card" onClick={() => setOpenedRunStart(run.startedAt)}>
                <span className="run-card-title">
                  <strong>{run.recipe.audience}</strong>
                  <span className="muted">
                    {new Date(run.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="muted">
                  {run.recipe.steps
                    .map((step) => `${fields[step.field].label} → ${format(step.field, step.value)}`)
                    .join(", ")}
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
