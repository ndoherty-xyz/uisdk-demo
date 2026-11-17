import { AgentBar } from "./ui/AgentBar";
import { TeamTable } from "./ui/TeamTable";

/**
 * Function to render the whole page: the team table and the floating agent bar.
 * @returns The page.
 */
function App() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Team</h1>
        <p>12 people · settings change as soon as you edit them</p>
      </header>
      <TeamTable />
      <AgentBar />
    </main>
  );
}

export { App };
