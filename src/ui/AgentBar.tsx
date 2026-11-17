import { useEffect, useState } from "react";
import { fields } from "../data/fields";
import { memberById } from "../data/members";
import { previewRecipe } from "../preview/usePreview";
import { requestRecipe } from "../recipe/requestRecipe";
import type { Recipe } from "../recipe/schema";
import type { Recording } from "../record/recording";
import { useRecorder } from "../record/useRecorder";
import { findRunTargets, useRunner } from "../run/useRunner";
import { ToastStack } from "./ToastStack";
import { format } from "./format";
import { RecipeCard } from "./RecipeCard";

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
 * Function to render the floating agent bar and, once made, the recipe card above it. Hidden from
 * the bridge so their own controls never show up in snapshots.
 * @returns The bar and card.
 */
function AgentBar() {
  const { state, changeCount, startRecording, finishRecording, keepMemberOnly, resetRecorder } = useRecorder();
  const [hint, setHint] = useState("");
  const [model, setModel] = useState("");
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  // Bumped per generation so the card's uncontrolled inputs start from the new recipe.
  const [recipeVersion, setRecipeVersion] = useState(0);
  const [isMaking, setIsMaking] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const { runState, runTurns, runRecipe, stopRun, resetRunner, clearRunTurns } = useRunner();

  // Development only: prefill the model picker with the server's default.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch("/api/config")
      .then((response) => response.json() as Promise<{ model: string }>)
      .then((config) => setModel((current) => current || config.model));
  }, []);

  /** Function to drop the recording and any recipe and go back to idle. */
  function startOver() {
    resetRecorder();
    resetRunner();
    setHint("");
    setRecipe(null);
    setRecipeError(null);
  }

  /**
   * Function to ask the model for a recipe from the recording and the hint.
   * @param recording The recording to generalize.
   */
  async function makeRecipe(recording: Recording) {
    setIsMaking(true);
    setRecipeError(null);
    const result = await requestRecipe(recording, hint, model);
    setIsMaking(false);
    if ("error" in result) return setRecipeError(result.error);
    setRecipe(result.recipe);
    setRecipeVersion((version) => version + 1);
  }

  const isCardShowing = state.phase === "recorded" && recipe !== null && runState.phase === "idle";
  const recordedMemberId = state.phase === "recorded" ? state.recording.memberId : "";
  // The table previews whatever the card shows; no card (or a run) means no preview.
  useEffect(
    () => previewRecipe(isCardShowing ? recipe : null, recordedMemberId),
    [isCardShowing, recipe, recordedMemberId],
  );

  // Recomputed on every table change: useRecorder re-renders the bar when history moves.
  const runCount = state.phase === "recorded" && recipe ? findRunTargets(recipe, state.recording.memberId).length : 0;

  return (
    <>
      <ToastStack turns={runTurns} onClear={clearRunTurns} />
      <div className="agent-dock" data-agent-hidden>
        {isCardShowing && state.phase === "recorded" && (
          <RecipeCard
            key={recipeVersion}
            recipe={recipe}
            recordedMember={memberById.get(state.recording.memberId)!}
            isMaking={isMaking}
            onChange={setRecipe}
            onRegenerate={() => makeRecipe(state.recording)}
          />
        )}
        <div className="agent-bar" data-phase={state.phase}>
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
              <button type="button" className="button" onClick={startOver}>
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

          {runState.phase === "running" && (
            <>
              <p className="bar-message" role="status">
                Updating <strong>{runState.member.name}</strong>
                <span className="muted">
                  {" "}
                  {runState.index + 1} of {runState.total}
                </span>
              </p>
              <button type="button" className="button" disabled={runState.stopping} onClick={stopRun}>
                {runState.stopping ? "Stopping…" : "Stop"}
              </button>
            </>
          )}

          {runState.phase === "finished" && (
            <>
              <p className="bar-message" role="status">
                {runState.stopped ? "Stopped. " : ""}Updated {runState.changedCount}{" "}
                {runState.changedCount === 1 ? "person" : "people"}.
                {runState.failedStepCount > 0 && ` ${runState.failedStepCount} changes couldn't be made.`}
              </p>
              <button type="button" className="button primary" onClick={startOver}>
                Start over
              </button>
            </>
          )}

          {state.phase === "recorded" && runState.phase === "idle" && (
            <div className="bar-recorded">
              <div className="bar-row">
                <p className="bar-message">
                  <strong>{memberById.get(state.recording.memberId)!.name}</strong>
                </p>
                <RecordedChips recording={state.recording} />
              </div>
              <form
                className="bar-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  makeRecipe(state.recording);
                }}
              >
                <input
                  className="hint-input"
                  placeholder="Do this for…"
                  aria-label="Who should this apply to?"
                  value={hint}
                  onChange={(event) => setHint(event.target.value)}
                />
                {import.meta.env.DEV && (
                  <input
                    className="model-input"
                    aria-label="Model"
                    title="OpenRouter model (development only)"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                )}
                <button type="button" className="button" onClick={startOver}>
                  Start over
                </button>
                {recipe ? (
                  <button
                    type="button"
                    className="button primary"
                    disabled={isMaking || runCount === 0}
                    onClick={() => runRecipe(recipe, state.recording.memberId)}
                  >
                    Run on {runCount} more
                  </button>
                ) : (
                  <button type="submit" className="button primary" disabled={isMaking}>
                    {isMaking ? "Making a recipe…" : "Make a recipe"}
                  </button>
                )}
              </form>
              {recipeError && (
                <p className="bar-error" role="alert">
                  {recipeError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { AgentBar };
