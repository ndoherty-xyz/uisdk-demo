import type { ServerEvent } from "openai/resources/live/live";
import { useRef, useState } from "react";
import { connectLive, type LiveConnection } from "../live/connection";
import { runVoiceTool, type Runner, type VoiceRequest } from "./handlers";

type VoiceStatus = "idle" | "connecting" | "listening" | "working" | "speaking" | "asleep" | "error";

type FunctionCallItem = { type: "function_call"; call_id: string; name: string; arguments: string };

/**
 * Function to echo a line to the dev server's log, so voice sessions can be read there.
 * @param parts What to log; objects are sent as JSON.
 */
function logToServer(...parts: unknown[]) {
  if (!import.meta.env.DEV) return;
  const line = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ");
  fetch("/api/log", { method: "POST", body: line }).catch(() => {});
}

/** No "speech done" event exists, so speaking ends this long after the last output delta. */
const speakingQuietMs = 900;
/** Captions fade out after this long with nothing said. */
const captionsQuietMs = 6000;
/** How long the captions' fade-out runs before they clear. */
const captionsFadeMs = 160;

/**
 * Function to turn a failed start into short copy for the pill; the raw error goes to the log.
 * @param error What `connectLive` threw.
 * @returns The message to show.
 */
function describeStartError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") return "Mic blocked. Allow it in the browser.";
  if (name === "NotFoundError") return "No mic found.";
  return "Couldn't start voice. Try again.";
}

/**
 * Function to run a voice session: connect, answer the backend's tool calls one at a time, and
 * track what the pill shows.
 * @param runner The runner's actions, for changes to everyone shown.
 * @returns The status, captions, any error, and start, end and mute actions.
 */
function useVoiceSession(runner: Runner) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captions, setCaptions] = useState({ person: "", agent: "" });
  const [areCaptionsFading, setAreCaptionsFading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const connectionRef = useRef<LiveConnection | null>(null);
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  // What the person said since the last delegation, and the request being worked on.
  const utteranceRef = useRef("");
  const agentSpeechRef = useRef("");
  const requestRef = useRef<VoiceRequest>({ utterance: "", hasRun: false });
  const toolQueueRef = useRef(Promise.resolve());
  const openCallCountRef = useRef(0);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const captionsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A new caption line starts after the agent pauses, and after the person speaks once the agent has.
  const isAgentLineDoneRef = useRef(true);
  const hasAgentSpokenRef = useRef(false);
  // Bumped on each start and end, so a connect that resolves after End is closed, not used.
  const connectAttemptRef = useRef(0);

  /** Function to clear captions, the speech behind them, and any error, for a fresh session. */
  function resetTranscripts() {
    clearTimeout(speakingTimerRef.current);
    clearTimeout(captionsTimerRef.current);
    clearTimeout(errorTimerRef.current);
    utteranceRef.current = "";
    agentSpeechRef.current = "";
    isAgentLineDoneRef.current = true;
    hasAgentSpokenRef.current = false;
    setCaptions({ person: "", agent: "" });
    setAreCaptionsFading(false);
    setErrorMessage(null);
  }

  /** Function to (re)start the countdown after which quiet captions fade out and clear. */
  function scheduleCaptionsFade() {
    setAreCaptionsFading(false);
    clearTimeout(captionsTimerRef.current);
    captionsTimerRef.current = setTimeout(() => {
      setAreCaptionsFading(true);
      captionsTimerRef.current = setTimeout(() => {
        setCaptions({ person: "", agent: "" });
        setAreCaptionsFading(false);
      }, captionsFadeMs);
    }, captionsQuietMs);
  }

  /**
   * Function to show an error that clears itself after a few seconds.
   * @param message The short message to show.
   */
  function showPassingError(message: string) {
    setErrorMessage(message);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), 5000);
  }

  /**
   * Function to handle one server event: captions, status, and tool calls.
   * @param event The event from the data channel.
   */
  function handleServerEvent(event: ServerEvent) {
    if (new URLSearchParams(location.search).has("debug")) console.debug("voice ←", event);
    switch (event.type) {
      case "session.started":
      case "session.resumed":
        setStatus("listening");
        break;
      case "session.paused":
        logToServer("asleep");
        setStatus("asleep");
        break;
      case "session.closed":
        logToServer("closed", event.reason);
        connectionRef.current?.close();
        connectionRef.current = null;
        resetTranscripts();
        setStatus("idle");
        if (event.reason !== "close_requested") showPassingError("Voice ended. Start again to keep talking.");
        break;
      case "error":
        logToServer("error", event.error);
        showPassingError("Something went wrong. Try again.");
        break;
      case "session.input_transcript.delta":
        if (hasAgentSpokenRef.current) {
          utteranceRef.current = "";
          hasAgentSpokenRef.current = false;
        }
        utteranceRef.current += event.delta;
        setCaptions({ person: utteranceRef.current.trim(), agent: "" });
        scheduleCaptionsFade();
        break;
      case "session.delegation.created":
        logToServer("person:", utteranceRef.current.trim());
        requestRef.current = { utterance: utteranceRef.current.trim(), hasRun: false };
        utteranceRef.current = "";
        setStatus("working");
        break;
      case "session.output_transcript.delta": {
        const isNewLine = isAgentLineDoneRef.current;
        isAgentLineDoneRef.current = false;
        hasAgentSpokenRef.current = true;
        setCaptions((current) => ({ ...current, agent: isNewLine ? event.delta : `${current.agent}${event.delta}` }));
        scheduleCaptionsFade();
        agentSpeechRef.current += event.delta;
        if (openCallCountRef.current === 0) setStatus("speaking");
        clearTimeout(speakingTimerRef.current);
        speakingTimerRef.current = setTimeout(() => {
          logToServer("voice said:", agentSpeechRef.current.trim());
          agentSpeechRef.current = "";
          isAgentLineDoneRef.current = true;
          setStatus((current) => (current === "speaking" ? "listening" : current));
        }, speakingQuietMs);
        break;
      }
      case "response.event": {
        const inner = event.event as { type: string; item?: FunctionCallItem | { type: string } };
        if (inner.type === "response.output_item.done" && inner.item?.type === "function_call") {
          answerFunctionCall(inner.item as FunctionCallItem);
        }
        if (inner.type === "response.output_text.done") logToServer("backend:", (inner as { text?: string }).text);
        if (inner.type === "response.completed" && openCallCountRef.current === 0) {
          setStatus((current) => (current === "working" ? "listening" : current));
        }
        break;
      }
    }
  }

  /**
   * Function to queue a tool call, run it, and send its output back so the backend continues.
   * @param call The function call item.
   */
  function answerFunctionCall(call: FunctionCallItem) {
    openCallCountRef.current++;
    setStatus("working");
    const request = requestRef.current;
    toolQueueRef.current = toolQueueRef.current.then(async () => {
      logToServer("tool →", call.name, call.arguments);
      const output = await runVoiceTool(call.name, call.arguments, request, runnerRef.current);
      logToServer("tool ←", call.name, output);
      openCallCountRef.current--;
      const connection = connectionRef.current;
      if (!connection) return;
      connection.send({
        type: "response.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) },
      });
      // Latency cut: don't wait for the inner response.completed; parallel_tool_calls is off.
      connection.send({ type: "response.create" });
    });
  }

  /** Function to ask for the mic and open a session. */
  async function startVoice() {
    const attempt = ++connectAttemptRef.current;
    resetTranscripts();
    setStatus("connecting");
    setIsMuted(false);
    try {
      const connection = await connectLive(handleServerEvent);
      if (attempt !== connectAttemptRef.current) {
        connection.send({ type: "session.close" });
        connection.close();
        return;
      }
      connectionRef.current = connection;
    } catch (error) {
      if (attempt !== connectAttemptRef.current) return;
      logToServer("start failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      setStatus("error");
      setErrorMessage(describeStartError(error));
    }
  }

  /** Function to end the session, or cancel one still connecting; the connection drops when `session.closed` arrives, or after 3 s. */
  function endVoice() {
    connectAttemptRef.current++;
    const connection = connectionRef.current;
    if (connection) {
      connection.send({ type: "session.close" });
      setTimeout(() => connection.close(), 3000);
    }
    connectionRef.current = null;
    resetTranscripts();
    setStatus("idle");
  }

  /** Function to turn the mic off or on without ending the session. */
  function toggleMute() {
    const connection = connectionRef.current;
    if (!connection) return;
    connection.micTrack.enabled = isMuted;
    setIsMuted(!isMuted);
  }

  return { status, errorMessage, captions, areCaptionsFading, isMuted, startVoice, endVoice, toggleMute };
}

export { useVoiceSession };
export type { VoiceStatus };
