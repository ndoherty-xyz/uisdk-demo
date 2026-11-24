import OpenAI from "openai";
import type { LiveCreateResponse, MediaSessionConfig } from "openai/resources/live/live";
import { backendInstructions, liveInstructions, voiceTools } from "../src/voice/tools";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Function to build the Live session config: GPT-Live in front, a Responses backend with the tools.
 * @returns the session object for `client.live.create`
 */
function sessionConfig(): MediaSessionConfig {
  return {
    model: process.env.LIVE_MODEL ?? "gpt-live-1.1",
    instructions: liveInstructions,
    audio: { output: { voice: process.env.LIVE_VOICE ?? "marin" } },
    wake_policy: { type: "speech", vad_threshold: 0.6 },
    idle_timeout_s: Number(process.env.IDLE_TIMEOUT_S ?? 20),
    delegation: {
      type: "responses",
      responses: {
        model: process.env.BACKEND_MODEL ?? "gpt-5.6-terra",
        instructions: backendInstructions,
        tools: voiceTools,
        tool_choice: "auto",
        parallel_tool_calls: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 800,
      },
    },
  };
}

/**
 * Function to exchange the browser's SDP offer for an answer by creating a Live WebRTC session.
 * @param sdp the browser's SDP offer
 * @returns the created session's id and transport answer
 */
export function createLiveSession(sdp: string): Promise<LiveCreateResponse> {
  return client.live.create({ session: sessionConfig(), transport: { type: "webrtc", sdp } });
}
