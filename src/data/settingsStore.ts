import type { FieldId, Settings } from "./fields";
import { initialSettingsByMember } from "./members";

// Every member's current settings. Rows mount and unmount as the table scrolls, so the controls
// start from here and write back to it; this is the one copy that covers rows off screen.
const settingsByMember = new Map(initialSettingsByMember);
let settingsVersion = 0;
const settingsListeners = new Set<() => void>();

/**
 * Function to read one member's current settings.
 * @param memberId The member.
 * @returns Their settings.
 */
function readSettings(memberId: string): Settings {
  return settingsByMember.get(memberId)!;
}

/**
 * Function to store a new value for one member's field and tell subscribers.
 * @param memberId The member.
 * @param fieldId The field that changed.
 * @param value Its new value.
 */
function writeSetting(memberId: string, fieldId: FieldId, value: string | boolean) {
  settingsByMember.set(memberId, { ...readSettings(memberId), [fieldId]: value });
  settingsVersion++;
  for (const listener of settingsListeners) listener();
}

/**
 * Function to listen for settings changes, for `useSyncExternalStore` with `readSettingsVersion`.
 * @param listener Called after every change.
 * @returns Stops listening.
 */
function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

/**
 * Function to read a number that goes up on every settings change.
 * @returns The version.
 */
function readSettingsVersion(): number {
  return settingsVersion;
}

export { readSettings, readSettingsVersion, subscribeSettings, writeSetting };
