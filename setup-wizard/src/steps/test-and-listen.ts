import * as p from "@clack/prompts";
import { claude } from "../env.js";
import { ask } from "../prompt.js";
import type { Step } from "../types.js";

/**
 * Step 4 — hand the terminal to interactive Claude once so it can clear its
 * one-time first-run prompts (trust this folder, pick a theme, and — in
 * extension mode — allow the Chrome extension) and finish its own setup. A
 * headless bot run (`claude -p`) can't answer those, so doing it here means the
 * bridge's later spawns start clean.
 *
 * There is no listener to start here: the Central connection is the bridge's
 * job (supervisord runs bridge.py independently of this wizard), and the old
 * setup-wizard listener was only ever a stub.
 */
export const testAndListen: Step = {
  id: "test-and-listen",
  title: "Finish Claude's first-run setup",
  summary: "Open Claude once interactively so it clears its first-run prompts",
  // Already done if Claude was run interactively earlier this setup (e.g. the
  // browser-login auth step handed off to interactive claude) — skip silently.
  autoSkip: true,
  // The confirm below is this step's own run/skip decision; don't double-prompt.
  ownsSkip: true,

  async check(ctx) {
    return Boolean(ctx.state.claudeInteractive);
  },

  async run(ctx) {
    // Keep CLAUDE_CHROME in sync with how browser control was set up, so this
    // interactive run matches what the bot will use (claude() passes --chrome
    // only in extension mode).
    process.env.CLAUDE_CHROME = ctx.state.browser === "devtools" ? "0" : "1";

    p.note(
      [
        "Let's open Claude Code once, interactively — this is the real agent",
        "you'll chat with. Running it now lets it finish its one-time setup",
        "(trust this folder, choose a theme, allow the Chrome extension) so the",
        "bot's later headless runs start clean.",
        "",
        "When you reach Claude's prompt, type /exit to come back here.",
      ].join("\n"),
      "Finish Claude's setup",
    );

    const go = await ask(
      p.confirm({
        message: "Open Claude interactively now?",
        initialValue: true,
      }),
    );
    if (!go) return { skipped: true };

    try {
      await claude([]);
    } catch {
      p.log.warn("Interactive Claude exited with an error; continuing.");
    }
    ctx.state.claudeInteractive = true;
    await ctx.save();
    p.log.success("Claude's first-run setup is done.");
  },
};
