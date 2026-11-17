import { useState, useSyncExternalStore } from "react";
import { history, memberIdOfRef } from "../bridge";
import { groupPersonEntriesByMember, recordingFromEntries, type Recording } from "./recording";

type RecorderState =
  | { phase: "idle" }
  | { phase: "recording"; start: number; empty: boolean }
  /** Changes touched several rows; `suggestedMemberId` is the one with the most entries. */
  | { phase: "conflict"; recordings: Recording[]; suggestedMemberId: string }
  /** `otherExamples` are earlier rows changed the same way, when the nudge started this. */
  | { phase: "recorded"; recording: Recording; otherExamples: Recording[] };

/**
 * Function to drive Show me / Done: remembers where history stood when recording began and turns
 * the entries since then into a one-person recording.
 * @returns The recorder state, a live count of changes while recording, and its actions.
 */
function useRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const position = useSyncExternalStore(history.subscribe, history.position);
  const changeCount = state.phase === "recording" ? position - state.start : 0;

  /** Function to begin a recording from the current history position. */
  function startRecording() {
    setState({ phase: "recording", start: history.position(), empty: false });
  }

  /** Function to end a recording and classify it as empty, multi-row, or recorded. */
  function finishRecording() {
    if (state.phase !== "recording") return;
    const entries = history.entries().slice(state.start, history.position());
    const entriesByMember = groupPersonEntriesByMember(entries, memberIdOfRef);
    const recordings = [...entriesByMember]
      .map(([memberId, memberEntries]) => recordingFromEntries(memberId, memberEntries))
      .filter((recording) => recording.changes.length > 0);
    if (recordings.length === 0) {
      setState({ ...state, empty: true });
    } else if (recordings.length === 1) {
      setState({ phase: "recorded", recording: recordings[0]!, otherExamples: [] });
    } else {
      const entryCount = (recording: Recording) => entriesByMember.get(recording.memberId)!.length;
      const suggested = recordings.reduce((most, recording) =>
        entryCount(recording) > entryCount(most) ? recording : most,
      );
      setState({ phase: "conflict", recordings, suggestedMemberId: suggested.memberId });
    }
  }

  /**
   * Function to resolve a multi-row recording by keeping one member's changes.
   * @param memberId The member to keep.
   */
  function keepMemberOnly(memberId: string) {
    if (state.phase !== "conflict") return;
    const recording = state.recordings.find((candidate) => candidate.memberId === memberId)!;
    setState({ phase: "recorded", recording, otherExamples: [] });
  }

  /**
   * Function to skip recording and use rows the person already changed the same way by hand.
   * @param examples The recordings, oldest first; the last becomes the recording.
   */
  function recordFromExamples(examples: Recording[]) {
    setState({ phase: "recorded", recording: examples.at(-1)!, otherExamples: examples.slice(0, -1) });
  }

  /** Function to drop whatever was recorded and go back to idle. */
  function resetRecorder() {
    setState({ phase: "idle" });
  }

  return { state, changeCount, startRecording, finishRecording, keepMemberOnly, recordFromExamples, resetRecorder };
}

export { useRecorder };
export type { RecorderState };
