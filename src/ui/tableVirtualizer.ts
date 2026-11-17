import { createVirtualizer } from "@ui-sdk/core";
import { members } from "../data/members";

const rowHeightPx = 45;
const headerHeightPx = 37;
const memberIndexById = new Map(members.map((member, index) => [member.id, index]));

const tableVirtualizer = createVirtualizer({
  count: () => members.length,
  estimate: () => rowHeightPx,
  key: (index) => members[index]!.id,
  scrollMargin: headerHeightPx,
});

/**
 * Function to bring a member's row on screen, if it isn't already, and wait until its controls are
 * mounted.
 * @param memberId The member.
 * @param behavior Smooth to glide there, instant to jump.
 * @returns When the row is on screen.
 */
async function scrollToMember(memberId: string, behavior: ScrollBehavior) {
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const findRow = () => document.querySelector<HTMLElement>(`tr[data-member-id="${memberId}"]`);
  const scroller = document.querySelector<HTMLElement>("[data-team-table]")!;
  const scrollerRect = scroller.getBoundingClientRect();
  const rowRect = findRow()?.getBoundingClientRect();
  const isRowInView =
    rowRect && rowRect.top >= scrollerRect.top + headerHeightPx && rowRect.bottom <= scrollerRect.bottom;
  if (isRowInView) return;
  const isSmooth = behavior === "smooth" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  tableVirtualizer.scrollToIndex(memberIndexById.get(memberId)!, {
    align: "center",
    behavior: isSmooth ? "smooth" : "instant",
  });
  if (isSmooth) {
    await new Promise((resolve) => {
      scroller.addEventListener("scrollend", resolve, { once: true });
      setTimeout(resolve, 800);
    });
  }
  while (!findRow()) await nextFrame();
  // One more frame, so the bridge has registered the row's controls.
  await nextFrame();
}

export { scrollToMember, tableVirtualizer };
