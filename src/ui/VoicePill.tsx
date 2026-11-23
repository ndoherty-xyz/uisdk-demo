import type { useVoiceSession } from "../voice/useVoiceSession";

const statusLabels = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening",
  working: "Working",
  speaking: "Speaking",
  asleep: "Asleep",
  error: "Couldn't connect",
} as const;

/**
 * Function to render the voice pill at the bottom center: Start talking, then status, captions,
 * Mute and End. Hidden from the bridge.
 * @param props.voice The voice session from `useVoiceSession`.
 * @returns The pill.
 */
function VoicePill({ voice }: { voice: ReturnType<typeof useVoiceSession> }) {
  const { status, errorMessage, captions, isMuted, startVoice, endVoice, toggleMute } = voice;
  const isActive = status !== "idle" && status !== "error";
  return (
    <div className="voice" data-agent-hidden>
      {isActive && (captions.person || captions.agent) && (
        <div className="voice-captions" aria-live="polite">
          {captions.person && <p className="muted">{captions.person}</p>}
          {captions.agent && <p>{captions.agent}</p>}
        </div>
      )}
      {errorMessage && (
        <p className="voice-error" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="voice-pill" data-status={status}>
        {isActive ? (
          <>
            <span className="voice-dot" aria-hidden />
            <span className="voice-status" role="status">
              {isMuted ? "Muted" : statusLabels[status]}
            </span>
            <button type="button" className="button" onClick={toggleMute} title="The session stays open">
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="button" onClick={endVoice}>
              End
            </button>
          </>
        ) : (
          <button type="button" className="button primary" onClick={startVoice}>
            Start talking
          </button>
        )}
      </div>
    </div>
  );
}

export { VoicePill };
