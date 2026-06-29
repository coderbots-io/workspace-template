import * as p from "@clack/prompts";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { claude, openUrl, run } from "../env.js";
import { ask } from "../prompt.js";
import type { Step } from "../types.js";

// A known-good sample app to try the agent on before the user points it at their
// own repo. PERN stack (Postgres / Express / React / Node) so it exercises a
// real database + server + client — a good first task for the agent.
const DEMO_REPO = "scottpersinger/to-do-app-pern-stack";

/**
 * Step — clone a sample app and let Claude set it up and run it, so the user
 * sees the agent work end to end before choosing their own repo.
 */
export const demoApp: Step = {
  id: "demo-app",
  title: "Try the agent on a demo app",
  summary: "Clone a sample PERN to-do app and let Claude set it up and run it",

  async check() {
    // Best-effort: if the demo is already cloned, default to skip on re-runs.
    return existsSync(path.join(os.homedir(), "projects", DEMO_REPO.split("/")[1]));
  },

  async run() {
    const dest = path.join(os.homedir(), "projects", DEMO_REPO.split("/")[1]);

    // --- Clone --------------------------------------------------------------
    const sClone = p.spinner();
    sClone.start(`Cloning ${DEMO_REPO} into ${dest}…`);
    try {
      await run("gh", ["repo", "clone", DEMO_REPO, dest], { stdio: "pipe" });
      sClone.stop(`Cloned to ${dest}.`);
    } catch {
      sClone.stop("Clone skipped (already present or failed).");
    }

    // --- Let Claude set up + run the app ------------------------------------
    p.note(
      [
        "A great first task for your agent: get a real app running.",
        "Claude Code will open in the demo repo and set it up — installing",
        "dependencies, provisioning a database, and starting the dev server.",
        "",
        "When the app is up, type /exit to come back here.",
      ].join("\n"),
      "Let Claude run the demo app",
    );

    const go = await ask(
      p.confirm({
        message: "Run Claude Code to set up and start the demo app?",
        initialValue: true,
      }),
    );
    if (go) {
      await claude(
        [
          "Set up and run this project locally. It's a PERN-stack (Postgres, " +
            "Express, React, Node) to-do app. Install dependencies, provision " +
            "and migrate the Postgres database it needs (Docker is available if " +
            "you want to run Postgres in a container), then start the app. When " +
            "it's running, tell me the local URL and port to open.",
        ],
        { cwd: dest },
      ).catch(() => p.log.warn("Claude Code exited; you can re-run this step."));
    }

    // --- Open the app -------------------------------------------------------
    const portInput = await ask(
      p.text({
        message: "What port is the app listening on?",
        placeholder: "3000",
        defaultValue: "3000",
      }),
    );
    const port = String(portInput || "3000").trim();
    await openUrl(`http://localhost:${port}`);
    p.log.success(`Opened http://localhost:${port} in the desktop browser.`);
  },
};
