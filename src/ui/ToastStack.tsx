import type { HistoryEntry } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";
import { useState, useSyncExternalStore } from "react";
import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { fieldIdOfLabel, fields } from "../data/fields";
import { memberById, type Member } from "../data/members";
import { findSupersedingEntry, planUndo, type HistoryView, type KeptEntry } from "../run/revert";
import type { RunTurn } from "../run/useRunner";
import { format } from "./format";
import { scrollToMember } from "./tableVirtualizer";

const maxVisibleToasts = 6;
// Sonner's stack: collapsed, the newest toast is in front and two more peek out above it.
const collapsedToastHeight = 42;
const collapsedPeekToasts = 3;
const collapsedPeekPx = 10;
const expandedGapPx = 8;

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
 * Function to render one change in a toast: what it set, what it was, and a way to remove it.
 * @param props.entry The agent's history entry.
 * @param props.isRemoved Whether it has been reverted from a toast.
 * @param props.isSuperseded Whether something changed the control after the agent.
 * @param props.onRemove Reverts just this change.
 * @returns The change line.
 */
function ChangeLine({
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
      className="toast-change"
      data-removed={isRemoved || undefined}
      onPointerEnter={() => highlightControl(entry.ref, true)}
      onPointerLeave={() => highlightControl(entry.ref, false)}
      onFocus={() => highlightControl(entry.ref, true)}
      onBlur={() => highlightControl(entry.ref, false)}
    >
      <span className="toast-change-text">
        {fields[fieldId].label} → {format(fieldId, entry.value)}{" "}
        <span className="muted">(was {format(fieldId, entry.previous)})</span>
      </span>
      {isRemoved ? (
        <span className="muted">Removed</span>
      ) : isSuperseded ? (
        <span className="muted">Changed since</span>
      ) : (
        <button type="button" className="link-button" onClick={onRemove}>
          Remove
        </button>
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

// Stack ----------

/**
 * Function to render the last run's toasts, one per row, stacked Sonner-style: collapsed, the
 * newest is in front showing its summary; hovering or focusing the stack lines them all up with
 * their changes.
 * @param props.turns The run's turns, oldest first.
 * @param props.onClear Dismisses every toast without reverting anything.
 * @returns The stack, or nothing when there are no turns.
 */
function ToastStack({ turns, onClear }: { turns: RunTurn[]; onClear: () => void }) {
  // Any table change can supersede a line, so re-render on every history move.
  const position = useSyncExternalStore(history.subscribe, history.position);
  const historyView: HistoryView = { entries: history.entries(), position, memberIdOf: memberIdOfEntry };
  const [removedEntryIds, setRemovedEntryIds] = useState<ReadonlySet<string>>(new Set());
  const [keptMessages, setKeptMessages] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  // Each toast's full height, measured, so the expanded stack can lay them out.
  const [toastHeights, setToastHeights] = useState<ReadonlyMap<string, number>>(new Map());

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
      await scrollToMember(memberId, "instant");
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
    setKeptMessages(undoPlan.keep.map((keptEntry) => describeKept(keptEntry, memberByEntryId.get(keptEntry.kept.id)!)));
    await revertEntries(undoPlan.revert);
  }

  if (turns.length === 0) return null;
  const hiddenCount = Math.max(0, turns.length - maxVisibleToasts);
  // Newest first: index 0 is the front toast.
  const visibleTurns = turns.slice(hiddenCount).toReversed();
  const expandedOffsets: number[] = [];
  let expandedListHeight = -expandedGapPx;
  for (const turn of visibleTurns) {
    expandedOffsets.push(expandedListHeight + expandedGapPx);
    expandedListHeight += (toastHeights.get(turn.member.id) ?? collapsedToastHeight) + expandedGapPx;
  }
  const collapsedListHeight =
    collapsedToastHeight + collapsedPeekPx * (Math.min(visibleTurns.length, collapsedPeekToasts) - 1);

  return (
    <section
      className="toast-stack"
      aria-label="Changes from the last run"
      data-agent-hidden
      onPointerEnter={() => setIsExpanded(true)}
      onPointerLeave={() => setIsExpanded(false)}
      onFocus={() => setIsExpanded(true)}
      onBlur={(event) => setIsExpanded(event.currentTarget.contains(event.relatedTarget))}
    >
      <div className="toast-stack-header">
        <button type="button" className="button" onClick={() => undoTurns(turns)}>
          Undo the whole run
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setKeptMessages([]);
            onClear();
          }}
        >
          Clear
        </button>
      </div>
      {keptMessages.length > 0 && (
        <ul className="toast-kept" role="status">
          {keptMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && <p className="toast-more">+{hiddenCount} more</p>}
      <ol
        className="toasts"
        data-expanded={isExpanded || undefined}
        style={{ height: isExpanded ? expandedListHeight : collapsedListHeight }}
      >
        {visibleTurns.map((turn, index) => {
          const removedCount = turn.entries.filter((entry) => removedEntryIds.has(entry.id)).length;
          const toastStyle = isExpanded
            ? {
                "--toast-y": `${-expandedOffsets[index]!}px`,
                "--toast-scale": 1,
                height: toastHeights.get(turn.member.id),
              }
            : { "--toast-y": `${-index * collapsedPeekPx}px`, "--toast-scale": 1 - index * 0.05 };
          return (
            <li
              key={turn.member.id}
              className="toast"
              data-front={index === 0 || undefined}
              data-buried={(!isExpanded && index >= collapsedPeekToasts) || undefined}
              style={{ ...toastStyle, zIndex: visibleTurns.length - index } as React.CSSProperties}
            >
              <div
                className="toast-content"
                ref={(content) => {
                  const observer = new ResizeObserver(() => {
                    const height = content!.offsetHeight + 2; // + the toast's top and bottom border
                    setToastHeights((heights) =>
                      heights.get(turn.member.id) === height ? heights : new Map(heights).set(turn.member.id, height),
                    );
                  });
                  observer.observe(content!);
                  return () => observer.disconnect();
                }}
              >
                <p className="toast-summary">
                  <strong>{turn.member.name}</strong>: {turn.entries.length}{" "}
                  {turn.entries.length === 1 ? "change" : "changes"}
                  {removedCount > 0 && <span className="muted">, {removedCount} removed</span>}
                </p>
                <ul className="toast-changes">
                  {turn.entries.map((entry) => (
                    <ChangeLine
                      key={entry.id}
                      entry={entry}
                      isRemoved={removedEntryIds.has(entry.id)}
                      isSuperseded={findSupersedingEntry(entry, historyView) !== undefined}
                      onRemove={() => revertEntries([entry])}
                    />
                  ))}
                </ul>
                <button type="button" className="button" onClick={() => undoTurns([turn])}>
                  Undo row
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { ToastStack };
