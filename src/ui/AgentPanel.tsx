import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { fields } from "../data/fields";
import { memberById } from "../data/members";
import { readSettings, readSettingsVersion, subscribeSettings } from "../data/settingsStore";
import { previewRecipe } from "../preview/usePreview";
import { matches } from "../recipe/evaluate";
import { requestRecipe } from "../recipe/requestRecipe";
import type { Clause, Recipe } from "../recipe/schema";
import type { Recording } from "../record/recording";
import { useNudge } from "../record/useNudge";
import { runScriptedTurn } from "../run/scriptedTurn";
import { findRunTargets, useRunner } from "../run/useRunner";
import agentAvatarUrl from "../assets/agent.png";
import { useVoiceSession } from "../voice/useVoiceSession";
import { GhostCursor } from "./GhostCursor";
import { VoicePill } from "./VoicePill";
import { RunHistory } from "./RunHistory";
import { readTableQuery, readVisibleMembers, subscribeTableQuery } from "./tableVirtualizer";
import { playSound } from "../sounds/sounds";
import { format } from "./format";

const attributeLabels = { team: "Team", title: "Title", location: "Location" };

// Pieces ----------

/**
 * Function to name the people a pattern was spotted on: "Maya Chen and Jonah Park".
 * @param examples The example rows.
 * @returns Their names, joined.
 */
function exampleNames(examples: Recording[]): string {
  return examples.map((example) => memberById.get(example.memberId)!.name).join(" and ");
}

/**
 * Function to render a clause as plain text: "Role is not Admin", "Team is Design or Support".
 * @param clause The clause.
 * @returns The text.
 */
function describeClause(clause: Clause): string {
  const { attr } = clause;
  const verb = clause.op === "neq" ? "is not" : "is";
  const values = [clause.value].flat();
  if (attr === "team" || attr === "title" || attr === "location") {
    return `${attributeLabels[attr]} ${verb} ${values.join(" or ")}`;
  }
  // Settings: show option labels, and "on"/"off" for switches.
  const valueTexts = values.map((value) => format(attr, fields[attr].kind === "switch" ? value === "true" : value));
  return `${fields[attr].label} ${verb} ${valueTexts.join(" or ")}`;
}

/**
 * Function to render a recipe's steps as chips: "Role → Editor".
 * @param props.steps The steps.
 * @returns The chip list.
 */
function StepChips({ steps }: { steps: Recipe["steps"] }) {
  return (
    <ul className="chips" aria-label="Changes">
      {steps.map((step) => (
        <li key={step.field} className="chip">
          {fields[step.field].label} → <strong>{format(step.field, step.value)}</strong>
        </li>
      ))}
    </ul>
  );
}

// Panel ----------

/**
 * Function to render agent mode: a launcher at the bottom right that surfaces what the agent noticed,
 * and the sidebar it opens, which holds the offer, the rule, the run and past runs as one place.
 * Hidden from the bridge so its own controls never show up in snapshots.
 * @returns The launcher or the sidebar.
 */
function AgentPanel() {
  const [isOpen, setIsOpen] = useState(false);
  // The offer the person opened, or a rule they asked for in words (no examples), as last edited.
  const [pattern, setPattern] = useState<{ examples: Recording[]; recipe: Recipe } | null>(null);
  const [instructionText, setInstructionText] = useState("");
  const [isMaking, setIsMaking] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const { runState, runRecipe, stopRun, resetRunner } = useRunner();
  const voice = useVoiceSession({ runRecipe, stopRun });
  const { spottedExamples, nudge, dismissNudge } = useNudge(pattern === null && runState.phase === "idle");
  // Counts follow the table's values and filters as they change.
  useSyncExternalStore(subscribeSettings, readSettingsVersion);
  const tableQuery = useSyncExternalStore(subscribeTableQuery, readTableQuery);

  const isPreviewing = isOpen && pattern !== null && runState.phase === "idle";
  useEffect(() => previewRecipe(isPreviewing ? pattern.recipe : null), [isPreviewing, pattern]);

  /** Function to open the offered pattern, ready for the person to adjust it. */
  function openNudge() {
    setPattern(nudge);
    setInstructionText("");
    setRecipeError(null);
    dismissNudge();
  }

  /** Function to close the opened pattern and forget any finished run. */
  function closePattern() {
    setPattern(null);
    setInstructionText("");
    setRecipeError(null);
    resetRunner();
  }

  /** Function to close the sidebar; a finished run counts as done, so it opens ready next time. */
  function closePanel() {
    if (runState.phase === "finished") closePattern();
    setIsOpen(false);
  }

  /**
   * Function to make or edit the recipe from the person's words: who gets it, what changes, or both.
   * @param event The form submit.
   */
  async function updateRule(event: FormEvent) {
    event.preventDefault();
    setIsMaking(true);
    setRecipeError(null);
    const result = await requestRecipe(pattern?.examples ?? [], instructionText, pattern?.recipe);
    setIsMaking(false);
    if ("error" in result) {
      playSound.error();
      return setRecipeError(result.error);
    }
    setPattern((current) => ({ examples: current?.examples ?? [], recipe: result.recipe }));
    setInstructionText("");
  }

  const nudgeRunCount = nudge ? findRunTargets(nudge.recipe).length : 0;
  const runCount = pattern ? findRunTargets(pattern.recipe).length : 0;
  const matchCount = pattern
    ? readVisibleMembers().filter((member) => matches(pattern.recipe, member, readSettings(member.id))).length
    : 0;
  // The table's filters narrow every run, so they're part of the rule; ones the recipe already has show once.
  const ruleTexts = (pattern?.recipe.filter?.all ?? []).map(describeClause);
  const tableFilterTexts = [
    tableQuery.team && `Team is ${tableQuery.team}`,
    tableQuery.location && `Location is ${tableQuery.location}`,
    tableQuery.search.trim() && `Name or title has “${tableQuery.search.trim()}”`,
  ].filter((text): text is string => Boolean(text) && !ruleTexts.includes(text as string));
  const hasInstruction = instructionText.trim() !== "";
  const view =
    runState.phase !== "idle"
      ? runState.phase
      : pattern
        ? "pattern"
        : nudge && nudgeRunCount > 0
          ? "offer"
          : spottedExamples
            ? "spotted"
            : "idle";

  const isOffering = view === "offer";
  const isFinishedRun = runState.phase === "finished" && !runState.stopped;
  useEffect(() => {
    if (isOffering) playSound.notification();
  }, [isOffering]);
  useEffect(() => {
    if (isFinishedRun) playSound.success();
  }, [isFinishedRun]);

  if (!isOpen) {
    return (
      <>
        <GhostCursor />
        <VoicePill voice={voice} />
        <button
          // Remount on each state, so the change plays its entrance.
          key={view}
          type="button"
          className="agent-launcher"
          data-view={view}
          data-agent-hidden
          onClick={() => {
            setIsOpen(true);
            if (view === "offer") openNudge();
          }}
        >
          <img className="agent-avatar" src={agentAvatarUrl} alt="" />
          {view === "idle" && "Agent"}
          {view === "spotted" && (
            <span>
              Noticed a pattern in <strong>{exampleNames(spottedExamples!)}</strong>…
            </span>
          )}
          {view === "offer" && (
            <span>
              Noticed a pattern in <strong>{exampleNames(nudge!.examples)}</strong>. <u>Automate?</u>
            </span>
          )}
          {view === "pattern" && "Automate"}
          {runState.phase === "running" && `Updating ${runState.index + 1} of ${runState.total}`}
          {runState.phase === "finished" && `Updated ${runState.changedCount}`}
        </button>
      </>
    );
  }

  return (
    <>
      <GhostCursor />
      <VoicePill voice={voice} />
      <aside className="agent-panel" aria-label="Agent" data-view={view} data-agent-hidden>
        <header className="agent-panel-header">
          <h2>
            <img className="agent-avatar" src={agentAvatarUrl} alt="" /> Agent
          </h2>
          <button type="button" className="icon-button" aria-label="Close agent" onClick={closePanel}>
            ×
          </button>
        </header>

        <div className="agent-panel-body">
          {view === "spotted" && (
            <p role="status">
              Noticed a pattern in <strong>{exampleNames(spottedExamples!)}</strong>. Working out the rest…
            </p>
          )}

          {view === "offer" && (
            <>
              <p role="status">
                Noticed a pattern in <strong>{exampleNames(nudge!.examples)}</strong>. Automate?
              </p>
              <StepChips steps={nudge!.recipe.steps} />
              <div className="agent-actions">
                <button type="button" className="button" onClick={dismissNudge}>
                  Not now
                </button>
                <button type="button" className="button primary" onClick={openNudge}>
                  Automate
                </button>
              </div>
            </>
          )}

          {(view === "idle" || view === "pattern") && (
            <form className="agent-pattern" aria-busy={isMaking} onSubmit={updateRule}>
              <label className="agent-field">
                <span>What do you want to do?</span>
                <input
                  className="hint-input"
                  placeholder={
                    pattern ? "e.g. only Seattle, also turn on deploy alerts" : "e.g. make designers in Seattle editors"
                  }
                  value={instructionText}
                  onChange={(event) => setInstructionText(event.target.value)}
                />
              </label>
              {pattern ? (
                <>
                  <section className="agent-section">
                    <h3>Changes</h3>
                    {pattern.examples.length > 0 && (
                      <p className="muted">Copied from {exampleNames(pattern.examples)}</p>
                    )}
                    <StepChips steps={pattern.recipe.steps} />
                  </section>
                  <section className="agent-section">
                    <h3>Rule</h3>
                    <ul className="chips" aria-label="Rule">
                      {ruleTexts.map((text) => (
                        <li key={text} className="chip" data-tone="agent">
                          {text}
                        </li>
                      ))}
                      {tableFilterTexts.map((text) => (
                        <li key={text} className="chip" data-tone="agent" data-source="table">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 16 16"
                            fill="none"
                            role="img"
                            aria-label="Table filter"
                          >
                            <path d="M2.5 3.5h11l-4.25 5v4l-2.5 1.5v-5.5z" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                          {text}
                        </li>
                      ))}
                      {ruleTexts.length === 0 && tableFilterTexts.length === 0 && (
                        <li className="chip" data-tone="agent">
                          Everyone
                        </li>
                      )}
                    </ul>
                    <p className="muted">
                      Matches {matchCount.toLocaleString()} {matchCount === 1 ? "person" : "people"}
                    </p>
                  </section>
                </>
              ) : (
                <p className="muted">Or change a couple of rows the same way and I'll offer to do the rest.</p>
              )}
              <div className="agent-actions">
                {pattern && (
                  <button type="button" className="button" onClick={closePattern}>
                    Cancel
                  </button>
                )}
                {hasInstruction || !pattern ? (
                  <button type="submit" className="button primary" disabled={isMaking || !hasInstruction}>
                    {isMaking ? "Working…" : pattern ? "Update" : "Make rule"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button primary"
                    disabled={runCount === 0}
                    onClick={() => {
                      playSound.send();
                      runRecipe(pattern.recipe);
                    }}
                  >
                    Run on {runCount.toLocaleString()}{" "}
                    {pattern.examples.length > 0 ? "more" : runCount === 1 ? "person" : "people"}
                  </button>
                )}
              </div>
              {recipeError && (
                <p className="agent-error" role="alert">
                  {recipeError}
                </p>
              )}
            </form>
          )}

          {runState.phase === "running" && (
            <>
              <p role="status">
                Updating <strong>{runState.member.name}</strong>
                <span className="muted">
                  {" "}
                  {runState.index + 1} of {runState.total}
                </span>
              </p>
              <div className="agent-run-progress">
                <progress className="agent-progress" value={runState.index + 1} max={runState.total} />
                <button type="button" className="button" disabled={runState.stopping} onClick={stopRun}>
                  {runState.stopping ? "Stopping…" : "Stop"}
                </button>
              </div>
            </>
          )}

          {runState.phase === "finished" && (
            <>
              <p role="status">
                {runState.stopped ? "Stopped. " : ""}Updated {runState.changedCount}{" "}
                {runState.changedCount === 1 ? "person" : "people"}.
                {runState.failedStepCount > 0 && ` ${runState.failedStepCount} changes couldn't be made.`}
              </p>
              <div className="agent-actions">
                <button type="button" className="button primary" onClick={closePattern}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>

        {import.meta.env.DEV && (
          <button type="button" className="link-button" onClick={runScriptedTurn}>
            Scripted turn
          </button>
        )}
        <RunHistory isRunning={runState.phase === "running"} />
      </aside>
    </>
  );
}

export { AgentPanel };
