import { defineSound } from "@web-kits/audio";
import { history } from "../bridge";
import * as minimal from "./minimal";

/** The few UI sounds the app plays, from the web-kits Minimal patch. */
const playSound = {
  select: defineSound(minimal.select),
  toggleOn: defineSound(minimal.toggleOn),
  toggleOff: defineSound(minimal.toggleOff),
  tap: defineSound(minimal.tap),
  notification: defineSound(minimal.notification),
  send: defineSound(minimal.send),
  success: defineSound(minimal.success),
  undo: defineSound(minimal.undo),
  error: defineSound(minimal.error),
};

// The person's own edits in the table click; the agent's are silent, so a run of hundreds isn't noise.
let lastSoundedEntryId: string | undefined;
history.subscribe(() => {
  const latestEntry = history.entries()[history.position() - 1];
  if (!latestEntry || latestEntry.id === lastSoundedEntryId) return;
  lastSoundedEntryId = latestEntry.id;
  if (latestEntry.source === "agent") return;
  if (latestEntry.key === "checked") (latestEntry.value ? playSound.toggleOn : playSound.toggleOff)();
  else playSound.select();
});

export { playSound };
