import type { Step } from "../types.js";
import { installAgent } from "./install-agent.js";
import { authenticateAgent } from "./authenticate-agent.js";
import { installExtension } from "./install-extension.js";
import { testAndListen } from "./test-and-listen.js";
// Trimmed from the flow for now — the agent handles repos on demand over Slack,
// so the demo-app and pick-repo onboarding steps are commented out (kept in the
// tree so they're easy to restore).
// import { demoApp } from "./demo-app.js";
// import { pickRepo } from "./pick-repo.js";

/** Ordered list of wizard steps. */
export const steps: Step[] = [
  installAgent,
  authenticateAgent,
  installExtension,
  testAndListen,
  // demoApp,
  // pickRepo,
];
