import { AgentPanel } from "./ui/AgentPanel";
import { TeamTable } from "./ui/TeamTable";

/**
 * Function to render the whole page: the team table, and agent mode beside it.
 * @returns The page.
 */
function App() {
  return (
    <div className="app">
      <main className="page">
        <header className="page-header">
          <h1>Team</h1>
          <p>Settings change as soon as you edit them.</p>
        </header>
        <TeamTable />
      </main>
      <AgentPanel />
    </div>
  );
}

export { App };
