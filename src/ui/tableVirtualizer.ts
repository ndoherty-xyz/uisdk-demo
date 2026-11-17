import { createVirtualizer } from "@ui-sdk/core";
import { members, type Member, type Team } from "../data/members";

const rowHeightPx = 45;
const headerHeightPx = 37;

// Filters and sort ----------

type SortColumn = "name" | "team" | "title" | "location";

/** What the toolbar and column headers ask the table to show. */
type TableQuery = {
  search: string;
  team: Team | null;
  location: string | null;
  sort: { column: SortColumn; direction: "asc" | "desc" } | null;
};

const unfilteredQuery: TableQuery = { search: "", team: null, location: null, sort: null };
let tableQuery = unfilteredQuery;
let visibleMembers = members;
let visibleIndexById = new Map(members.map((member, index) => [member.id, index]));
const tableQueryListeners = new Set<() => void>();

const tableVirtualizer = createVirtualizer({
  count: () => visibleMembers.length,
  estimate: () => rowHeightPx,
  key: (index) => visibleMembers[index]!.id,
  scrollMargin: headerHeightPx,
});

/**
 * Function to filter and sort the table, and scroll back to the top when the rows change.
 * @param nextQuery The new filters and sort.
 */
function setTableQuery(nextQuery: TableQuery) {
  tableQuery = nextQuery;
  const search = nextQuery.search.trim().toLowerCase();
  const filteredMembers = members.filter(
    (member) =>
      (!search || `${member.name} ${member.title}`.toLowerCase().includes(search)) &&
      (!nextQuery.team || member.team === nextQuery.team) &&
      (!nextQuery.location || member.location === nextQuery.location),
  );
  const { sort } = nextQuery;
  visibleMembers = sort
    ? filteredMembers.sort((a, b) => a[sort.column].localeCompare(b[sort.column]) * (sort.direction === "asc" ? 1 : -1))
    : filteredMembers;
  visibleIndexById = new Map(visibleMembers.map((member, index) => [member.id, index]));
  document.querySelector("[data-team-table]")?.scrollTo({ top: 0 });
  tableVirtualizer.refresh();
  for (const listener of tableQueryListeners) listener();
}

/**
 * Function to listen for filter and sort changes, for `useSyncExternalStore`.
 * @param listener Called after every change.
 * @returns Stops listening.
 */
function subscribeTableQuery(listener: () => void): () => void {
  tableQueryListeners.add(listener);
  return () => tableQueryListeners.delete(listener);
}

/**
 * Function to read the current filters and sort.
 * @returns The query.
 */
function readTableQuery(): TableQuery {
  return tableQuery;
}

/**
 * Function to read the rows the table shows, in order.
 * @returns The filtered, sorted members.
 */
function readVisibleMembers(): Member[] {
  return visibleMembers;
}

// Scrolling ----------

/**
 * Function to bring a member's row on screen, if it isn't already, two rows below the header, and
 * wait until its controls are mounted. Clears the filters first if they hide the row.
 * @param memberId The member.
 * @param glideMs How long the scroll glides for; 0, or reduced motion, jumps.
 * @returns When the row is on screen.
 */
async function scrollToMember(memberId: string, glideMs: number) {
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const findRow = () => document.querySelector<HTMLElement>(`tr[data-member-id="${memberId}"]`);
  if (!visibleIndexById.has(memberId)) {
    setTableQuery({ ...unfilteredQuery, sort: tableQuery.sort });
    await nextFrame();
  }
  const scroller = document.querySelector<HTMLElement>("[data-team-table]")!;
  const scrollerRect = scroller.getBoundingClientRect();
  const rowRect = findRow()?.getBoundingClientRect();
  const isRowInView =
    rowRect && rowRect.top >= scrollerRect.top + headerHeightPx && rowRect.bottom <= scrollerRect.bottom;
  if (isRowInView) return;
  // Rows aren't measured, so every row is exactly rowHeightPx and the target is known up front.
  const fromTop = scroller.scrollTop;
  const toTop = Math.min(
    Math.max(0, (visibleIndexById.get(memberId)! - 2) * rowHeightPx),
    scroller.scrollHeight - scroller.clientHeight,
  );
  if (glideMs > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const startTime = performance.now();
    let progress = 0;
    while (progress < 1) {
      await nextFrame();
      progress = Math.min(1, (performance.now() - startTime) / glideMs);
      scroller.scrollTop = fromTop + (toTop - fromTop) * (1 - (1 - progress) ** 3);
    }
  } else {
    scroller.scrollTop = toTop;
  }
  while (!findRow()) await nextFrame();
  // One more frame, so the bridge has registered the row's controls.
  await nextFrame();
}

export {
  readTableQuery,
  readVisibleMembers,
  scrollToMember,
  setTableQuery,
  subscribeTableQuery,
  tableVirtualizer,
  unfilteredQuery,
};
export type { SortColumn, TableQuery };
