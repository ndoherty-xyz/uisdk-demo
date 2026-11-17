import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { fields } from "../data/fields";
import { memberById } from "../data/members";
import { readSettings, readSettingsVersion, subscribeSettings } from "../data/settingsStore";
import { previewRecipe } from "../preview/usePreview";
import { matches } from "../recipe/evaluate";
import { requestRecipe } from "../recipe/requestRecipe";
import type { Clause, Recipe } from "../recipe/schema";
import type { Recording } from "../record/recording";
import { useNudge, type Nudge } from "../record/useNudge";
import { findRunTargets, useRunner } from "../run/useRunner";
import agentAvatarUrl from "../assets/agent.png";
import { GhostCursor } from "./GhostCursor";
import { RunHistory } from "./RunHistory";
import { readTableQuery, readVisibleMembers, subscribeTableQuery } from "./tableVirtualizer";
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
  const [model, setModel] = useState("");
  // The offer the person opened, with the recipe as last made from their words.
  const [pattern, setPattern] = useState<Nudge | null>(null);
  const [audienceText, setAudienceText] = useState("");
  const [isMaking, setIsMaking] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const { runState, runs, runRecipe, stopRun, resetRunner, clearRuns } = useRunner();
  const { spottedExamples, nudge, dismissNudge } = useNudge(pattern === null && runState.phase === "idle", model);
  // Counts follow the table's values and filters as they change.
  useSyncExternalStore(subscribeSettings, readSettingsVersion);
  const tableQuery = useSyncExternalStore(subscribeTableQuery, readTableQuery);

  // Development only: prefill the model picker with the server's default.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch("/api/config")
      .then((response) => response.json() as Promise<{ model: string }>)
      .then((config) => setModel((current) => current || config.model));
  }, []);

  const isPreviewing = isOpen && pattern !== null && runState.phase === "idle";
  useEffect(() => previewRecipe(isPreviewing ? pattern.recipe : null), [isPreviewing, pattern]);

  /** Function to open the offered pattern, ready for the person to say who should get it. */
  function openNudge() {
    setPattern(nudge);
    setAudienceText(nudge!.recipe.audience);
    setRecipeError(null);
    dismissNudge();
  }

  /** Function to close the opened pattern and forget any finished run. */
  function closePattern() {
    setPattern(null);
    resetRunner();
  }

  /** Function to close the sidebar; a finished run counts as done, so it opens ready next time. */
  function closePanel() {
    if (runState.phase === "finished") closePattern();
    setIsOpen(false);
  }

  /**
   * Function to remake the recipe from the person's description of who should get it.
   * @param event The form submit.
   */
  async function updateRule(event: FormEvent) {
    event.preventDefault();
    setIsMaking(true);
    setRecipeError(null);
    const result = await requestRecipe(pattern!.examples, audienceText, model);
    setIsMaking(false);
    if ("error" in result) return setRecipeError(result.error);
    setPattern((current) => current && { ...current, recipe: result.recipe });
    setAudienceText(result.recipe.audience);
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
  const isAudienceEdited = pattern !== null && audienceText.trim() !== pattern.recipe.audience;
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

  if (!isOpen) {
    return (
      <>
        <GhostCursor />
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
          {view === "idle" && (
            <p className="muted">Change a couple of rows the same way and I'll offer to do the rest.</p>
          )}

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

          {view === "pattern" && (
            <form className="agent-pattern" aria-busy={isMaking} onSubmit={updateRule}>
              <p>
                You gave <strong>{exampleNames(pattern!.examples)}</strong>
              </p>
              <StepChips steps={pattern!.recipe.steps} />
              <label className="agent-field">
                <span>Who should get this?</span>
                <input
                  className="hint-input"
                  value={audienceText}
                  onChange={(event) => setAudienceText(event.target.value)}
                />
              </label>
              <ul className="chips" aria-label="Rule">
                {ruleTexts.map((text) => (
                  <li key={text} className="chip" data-tone="agent">
                    {text}
                  </li>
                ))}
                {tableFilterTexts.map((text) => (
                  <li key={text} className="chip" data-tone="agent" data-source="table">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" role="img" aria-label="Table filter">
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
              <p className="agent-match-count muted">
                Matches {matchCount.toLocaleString()} {matchCount === 1 ? "person" : "people"}
              </p>
              {import.meta.env.DEV && (
                <input
                  className="model-input"
                  aria-label="Model"
                  title="OpenRouter model (development only)"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              )}
              <div className="agent-actions">
                <button type="button" className="button" onClick={closePattern}>
                  Cancel
                </button>
                {isAudienceEdited ? (
                  <button type="submit" className="button primary" disabled={isMaking || !audienceText.trim()}>
                    {isMaking ? "Updating…" : "Update rule"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button primary"
                    disabled={runCount === 0}
                    onClick={() => runRecipe(pattern!.recipe)}
                  >
                    Run on {runCount.toLocaleString()} more
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

        <RunHistory runs={runs} isRunning={runState.phase === "running"} onClear={clearRuns} />
      </aside>
    </>
  );
}

export { AgentPanel };
