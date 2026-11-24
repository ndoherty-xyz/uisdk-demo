import type { useVoiceSession } from "../voice/useVoiceSession";

type Voice = ReturnType<typeof useVoiceSession>;

const statusLabels = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening",
  working: "Working",
  speaking: "Speaking",
  asleep: "Asleep",
  error: "",
} as const;

/**
 * Function to tell whether a voice session is open.
 * @param voice The voice session.
 * @returns True while connecting or connected.
 */
function isVoiceActive(voice: Voice): boolean {
  return voice.status !== "idle" && voice.status !== "error";
}

/**
 * Function to draw the mic icon, struck through when muted.
 * @param props.isMuted Whether to strike it through.
 * @returns The icon.
 */
function MicIcon({ isMuted }: { isMuted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="5.75" y="1.5" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" strokeLinecap="round" />
      {isMuted && <path d="M2.5 2.5l11 11" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Function to render the agent's voice controls: a mic to start, then status, Mute and End.
 * @param props.voice The voice session from `useVoiceSession`.
 * @returns The controls.
 */
function VoiceControls({ voice }: { voice: Voice }) {
  const { status, isMuted, startVoice, endVoice, toggleMute } = voice;
  if (!isVoiceActive(voice)) {
    return (
      <button type="button" className="round-button" aria-label="Start talking" title="Start talking" onClick={startVoice}>
        <MicIcon isMuted={false} />
      </button>
    );
  }
  // Muted only replaces the label while the agent is waiting on the person.
  const statusLabel = isMuted && (status === "listening" || status === "asleep") ? "Muted" : statusLabels[status];
  return (
    <div className="voice-controls" data-status={status} data-muted={isMuted || undefined}>
      <span className="voice-dot" aria-hidden />
      <span className="voice-status" role="status">
        {statusLabel}
      </span>
      <button
        type="button"
        className="round-button"
        aria-label={isMuted ? "Unmute" : "Mute"}
        title={isMuted ? "Unmute" : "Mute (the session stays open)"}
        aria-pressed={isMuted}
        disabled={status === "connecting"}
        onClick={toggleMute}
      >
        <MicIcon isMuted={isMuted} />
      </button>
      <button type="button" className="round-button voice-end" aria-label="End" title="End" onClick={endVoice}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <rect width="12" height="12" rx="2.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Function to render what was last said, by the person and the agent, and any voice error.
 * @param props.voice The voice session from `useVoiceSession`.
 * @returns The captions and error, or nothing.
 */
function VoiceCaptions({ voice }: { voice: Voice }) {
  const { captions, areCaptionsFading, errorMessage } = voice;
  const hasCaptions = isVoiceActive(voice) && Boolean(captions.person || captions.agent);
  if (!errorMessage && !hasCaptions) return null;
  return (
    <div className="voice-transcript">
      {errorMessage && (
        <p className="voice-error" role="alert">
          {errorMessage}
        </p>
      )}
      {hasCaptions && (
        <div className="voice-captions" data-fading={areCaptionsFading || undefined}>
          {captions.person && <p className="muted">{captions.person}</p>}
          {captions.agent && <p>{captions.agent}</p>}
        </div>
      )}
    </div>
  );
}

export { VoiceCaptions, VoiceControls };
