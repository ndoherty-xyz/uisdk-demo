import { fields } from "../data/fields";
import { memberById } from "../data/members";
import type { Recording } from "../record/recording";
import { useRecorder } from "../record/useRecorder";
import { format } from "./format";

// Pieces ----------

/**
 * Function to render a recording's changes as plain chips: "Role → Editor".
 * @param props.recording The recording to show.
 * @returns The chip list.
 */
function RecordedChips({ recording }: { recording: Recording }) {
  return (
    <ul className="chips" aria-label="Recorded changes">
      {recording.changes.map((change) => (
        <li key={change.field} className="chip">
          {fields[change.field].label} → <strong>{format(change.field, change.to)}</strong>
        </li>
      ))}
    </ul>
  );
}

// Bar ----------

/**
 * Function to render the floating agent bar. Hidden from the bridge so its own controls never
 * show up in snapshots.
 * @returns The bar.
 */
function AgentBar() {
  const { state, changeCount, startRecording, finishRecording, keepMemberOnly, resetRecorder } = useRecorder();

  return (
    <div className="agent-bar" data-agent-hidden data-phase={state.phase}>
      {state.phase === "idle" && (
        <>
          <p className="bar-message">Change one row once, and I'll do it for the rest.</p>
          <button type="button" className="button primary" onClick={startRecording}>
            Show me
          </button>
        </>
      )}

      {state.phase === "recording" && (
        <>
          <span className="recording-dot" aria-hidden="true" />
          <p className="bar-message" role="status">
            {state.empty && changeCount === 0
              ? "Nothing changed yet. Change a setting in one row, then press Done."
              : "Recording. Change one person's settings, then press Done."}
            {changeCount > 0 && <span className="muted"> {changeCount} so far</span>}
          </p>
          <button type="button" className="button" onClick={resetRecorder}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={finishRecording}>
            Done
          </button>
        </>
      )}

      {state.phase === "conflict" && (
        <>
          <p className="bar-message" role="alert">
            That touched {state.recordings.length} people. Record one person at a time.
          </p>
          <button type="button" className="button" onClick={startRecording}>
            Record again
          </button>
          <button type="button" className="button primary" onClick={() => keepMemberOnly(state.suggestedMemberId)}>
            Use {memberById.get(state.suggestedMemberId)!.name.split(" ")[0]}'s changes only
          </button>
        </>
      )}

      {state.phase === "recorded" && (
        <div className="bar-recorded">
          <div className="bar-row">
            <p className="bar-message">
              <strong>{memberById.get(state.recording.memberId)!.name}</strong>
            </p>
            <RecordedChips recording={state.recording} />
          </div>
          <div className="bar-row">
            <input className="hint-input" placeholder="Do this for…" aria-label="Who should this apply to?" />
            <button type="button" className="button" onClick={resetRecorder}>
              Start over
            </button>
            <button type="button" className="button primary" disabled title="Arrives in M2">
              Make a recipe
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { AgentBar };
