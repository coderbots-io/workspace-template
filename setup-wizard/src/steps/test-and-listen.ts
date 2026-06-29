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
    // Code's one-time first-run prompts (trust this folder, pick a theme). If
    // Claude hasn't been run interactively yet this setup (e.g. the user
    // authenticated with an API key rather than the browser login), get that
    // first run out of the way first.
    if (!ctx.state.claudeInteractive) {
      // In the VS Code editor we keep the wizard in its own terminal and send
      // the user to a SEPARATE terminal tab for Claude (the "coderbots: Claude"
      // task), so the wizard's instructions stay on screen. Over plain SSH (no
      // VS Code) there's only one terminal, so we hand it over inline instead.
      const inVsCode = process.env.TERM_PROGRAM === "vscode";

      if (inVsCode) {
        p.note(
          [
            "The first time Claude Code runs it asks a couple of one-time",
            "questions (trust this folder, choose a theme). A headless test",
            "can't answer those, so run Claude once in its own terminal first:",
            "",
            "  1. Terminal → Run Task… → “coderbots: Claude”",
            "     (or open a new terminal with Ctrl/Cmd+Shift+` and run: claude)",
            "  2. Answer the first-run questions until you reach Claude's prompt.",
            "  3. Type /exit, then come back to THIS terminal.",
            "",
            "This is the real agent you'll chat with — leave that tab open to",
            "talk to it any time.",
          ].join("\n"),
          "First run of Claude",
        );

        // Block here until the user confirms they've finished the first run.
        // Loop so an accidental "no" just re-asks rather than skipping setup.
        for (;;) {
          const done = await ask(
            p.confirm({
              message: "Finished Claude's first run in the other terminal?",
              initialValue: true,
            }),
          );
          if (done) break;
          p.log.info(
            'Run the "coderbots: Claude" task, complete the questions, then /exit.',
          );
        }
        ctx.state.claudeInteractive = true;
        await ctx.save();
      } else {
        p.note(
          [
            "The first time Claude Code runs it asks a couple of one-time",
            "questions (trust this folder, choose a theme). A headless test",
            "can't answer those, so we'll open Claude interactively once.",
            "",
            "When you reach Claude's prompt, type /exit to come right back here.",
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
