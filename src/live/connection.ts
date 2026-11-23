import type { ClientEvent, ServerEvent } from "openai/resources/live/live";

/** An open Live session: send client events, close it, and the mic track for muting. */
export type LiveConnection = {
  sessionId: string;
  send: (event: ClientEvent) => void;
  close: () => void;
  micTrack: MediaStreamTrack;
};

/**
 * Function to open a Live WebRTC session through the server and resolve once `session.started` arrives.
 * @param onServerEvent called with every event from the `oai-events` data channel, including `session.started`
 * @returns the open connection
 */
export async function connectLive(onServerEvent: (event: ServerEvent) => void): Promise<LiveConnection> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0]!;

  const peer = new RTCPeerConnection();
  peer.addTrack(micTrack, mic);
  const speaker = new Audio();
  speaker.autoplay = true;
  peer.ontrack = (trackEvent) => (speaker.srcObject = trackEvent.streams[0] ?? null);

  // The data channel and its listeners must exist before the offer.
  const channel = peer.createDataChannel("oai-events");
  const started = new Promise<void>((resolve, reject) => {
    channel.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as ServerEvent;
      onServerEvent(event);
      if (event.type === "session.started") resolve();
      if (event.type === "error") reject(new Error(event.error.message));
    };
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: offer.sdp }),
  });
  const body = (await response.json()) as { sessionId: string; sdp: string } | { error: string };
  if ("error" in body) {
    micTrack.stop();
    peer.close();
    throw new Error(body.error);
  }
  await peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
  await started;

  return {
    sessionId: body.sessionId,
    send: (event) => channel.send(JSON.stringify(event)),
    close: () => {
      micTrack.stop();
      peer.close();
    },
    micTrack,
  };
}
