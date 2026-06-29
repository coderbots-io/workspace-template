import * as p from "@clack/prompts";
import { claude } from "../env.js";
import { startListener } from "../listener.js";
import { ask } from "../prompt.js";
import type { Step } from "../types.js";

/**
 * Step 4 — smoke-test that Claude Code works (ideally driving Chrome via the
 * extension), then start the agent event listener that connects to Central.
 */
export const testAndListen: Step = {
  id: "test-and-listen",
  title: "Test the agent + start the listener",
  summary: "Run a Claude Code + Chrome smoke test and connect to Central",

  async run(ctx) {
    // --- Smoke test ---------------------------------------------------------
    // Adapt to how step 3 set up browser control. Keep CLAUDE_CHROME in sync so
    // claude() passes --chrome only in extension mode.
    const devtools = ctx.state.browser === "devtools";
    process.env.CLAUDE_CHROME = devtools ? "0" : "1";

    // --- First-run warm-up --------------------------------------------------
    // The smoke test below is headless (`claude -p`), which can't answer Claude
    // Code's one-time first-run prompts (trust this folder, pick a theme, and —
    // in extension mode — allow the Chrome extension). If Claude hasn't been run
    // interactively yet this setup (e.g. the user authenticated with an API key
    // rather than the browser login), hand this terminal to interactive Claude
    // once so they can clear those prompts, then /exit straight back here.
    if (!ctx.state.claudeInteractive) {
      p.note(
        [
          "The first time Claude Code runs it asks a few one-time questions",
          `(trust this folder, choose a theme${devtools ? "" : ", allow the Chrome extension"}).`,
          "A headless test can't answer those, so let's open Claude interactively",
          "once to get them out of the way — this is the real agent you'll chat with.",
          "",
          "When you reach Claude's prompt, type /exit to come right back here and",
          "run the smoke test.",
        ].join("\n"),
        "First run of Claude",
      );

      const warmUp = await ask(
        p.confirm({
          message: "Open Claude interactively to finish first-time setup?",
          initialValue: true,
        }),
      );
      if (warmUp) {
        try {
          await claude([]);
        } catch {
          p.log.warn("Interactive Claude exited with an error; continuing.");
        }
        ctx.state.claudeInteractive = true;
        await ctx.save();
      }
    }

    p.note(
      [
        devtools
          ? "Claude Code will run a one-shot prompt that uses the Chrome DevTools"
          : "Claude Code will run a one-shot prompt that uses the Chrome extension",
        "to open a page and report its title. Watch the desktop browser.",
      ].join("\n"),
      "Smoke test",
    );

    const doTest = await ask(p.confirm({ message: "Run the smoke test now?" }));

    if (doTest) {
      const prompt = devtools
        ? [
            "Using the chrome-devtools MCP tools, open https://example.com and",
            "tell me the page title. If you cannot reach the browser, say so.",
          ].join(" ")
        : [
            "Using the Claude-in-Chrome extension, open https://example.com and",
            "tell me the page title.",
            "If more than one browser is connected, do NOT ask me to choose —",
            "automatically select the one running on Linux (this codespace's",
            "desktop); a macOS/Windows browser, if present, is the user's laptop",
            "and must be ignored. If exactly one is connected, just use it.",
            "If you cannot reach any browser, say so.",
          ].join(" ");
      try {
        await claude(["-p", prompt]);
        const ok = await ask(
          p.confirm({ message: "Did Claude open the page and report the title?" }),
        );
        if (!ok) {
          p.log.warn(
            "Smoke test not confirmed — re-check the browser-control setup (step 3) and retry.",
          );
        } else {
          p.log.success("Claude Code + Chrome are working.");
        }
      } catch {
        p.log.warn("Smoke test command failed; continuing.");
      }
    }

    // --- Start the listener -------------------------------------------------
    const s = p.spinner();
    s.start("Starting the agent event listener…");
    const res = await startListener();
    if (res.ok) {
      s.stop("Listener connected to Central.");
    } else {
      s.stop("Listener not started.");
      p.log.warn(res.reason);
    }
  },
};
