import { elementOf } from "@ui-sdk/react/observe";
import agentAvatarUrl from "../assets/agent.png";

const pressMs = 120;
const hideDelayMs = 1500;

// One cursor for the page, moved by the runner, so its element and position live at module level.
let cursorElement: HTMLDivElement | null = null;
let cursorPoint: { x: number; y: number } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

// Movement ----------

/**
 * Function to move the ghost cursor to a control's center and press it, ready for the agent's change.
 * Jumps without animating when the person prefers reduced motion.
 * @param ref The control's ref.
 * @param glideMs How long the move takes.
 * @returns When the cursor has landed.
 */
async function moveGhostCursor(ref: string, glideMs: number): Promise<void> {
  const cursor = cursorElement!;
  // A select's element is its visually hidden label, so aim at the visible control in its cell.
  const control = elementOf(ref).closest("td")!.querySelector('[data-slot="select-trigger"], [data-slot="switch"]')!;
  control.scrollIntoView({ block: "nearest" });
  const rect = control.getBoundingClientRect();
  const target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  // The first move of a run starts from the agent panel's edge.
  const panelRect = document.querySelector(".agent-panel")!.getBoundingClientRect();
  const start = cursorPoint ?? { x: panelRect.left, y: panelRect.top + 160 };
  cursorPoint = target;

  clearTimeout(hideTimer);
  cursor.dataset.visible = "";
  const toTransform = `translate(${target.x}px, ${target.y}px)`;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cursor.style.transform = toTransform;
    return;
  }
  await cursor.animate([{ transform: `translate(${start.x}px, ${start.y}px)` }, { transform: toTransform }], {
    duration: glideMs,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  }).finished;
  cursor.style.transform = toTransform;
  // Only unhurried moves press; quick ones just point.
  if (glideMs < pressMs * 2) return;
  await cursor
    .querySelector(".ghost-cursor-arrow")!
    .animate([{ scale: 1 }, { scale: 0.9 }, { scale: 1 }], { duration: pressMs, easing: "ease-out" }).finished;
}

/**
 * Function to tint a control's cell in the agent's color and fade it out, so a change stands out.
 * @param ref The changed control's ref.
 */
function flashChangedCell(ref: string) {
  // A select's element is its visually hidden label, so tint the cell.
  (elementOf(ref) as HTMLElement)
    .closest("td")!
    .animate(
      [{ backgroundColor: "color-mix(in srgb, var(--agent) 22%, transparent)" }, { backgroundColor: "transparent" }],
      { duration: 1400, easing: "ease-out" },
    );
}

/** Function to hide the ghost cursor a moment after a run ends; the next run starts from the panel. */
function hideGhostCursor() {
  hideTimer = setTimeout(() => {
    delete cursorElement!.dataset.visible;
    cursorPoint = null;
  }, hideDelayMs);
}

// Cursor ----------

/**
 * Function to render the agent's ghost cursor: an arrow with the agent's avatar that the runner moves
 * to each control before changing it. Hidden from the bridge and from pointer events.
 * @returns The cursor.
 */
function GhostCursor() {
  return (
    <div
      className="ghost-cursor"
      data-agent-hidden
      aria-hidden="true"
      ref={(element) => {
        cursorElement = element;
      }}
    >
      <svg className="ghost-cursor-arrow" width="18" height="22" viewBox="0 0 18 22">
        <path d="M1 1 L1 18 L5.5 13.5 L8.5 20.5 L11.5 19 L8.5 12.5 L15 12.5 Z" />
      </svg>
      <img className="ghost-cursor-avatar" src={agentAvatarUrl} alt="" />
    </div>
  );
}

export { flashChangedCell, GhostCursor, hideGhostCursor, moveGhostCursor };
