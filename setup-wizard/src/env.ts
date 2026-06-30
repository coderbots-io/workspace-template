import { execa, type Options, type ResultPromise } from "execa";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The sandbox-disabled Chrome wrapper baked into the agent-dev-desktop image
 * (see the repo's .devcontainer/Dockerfile). Spawning this directly puts the
 * page on the XFCE desktop (DISPLAY :1) that the user sees over KasmVNC.
 */
export const CHROME = "/usr/local/bin/google-chrome";

/** Home for wizard state and any other coderbots-local files. */
export const CODERBOTS_HOME = path.join(os.homedir(), ".coderbots");

/**
 * The Slack/Ably bridge directory. Its `.env` is what the bot (app.py /
 * bridge.py) loads, so secrets the wizard collects (e.g. an Anthropic API
 * key) are persisted here. Derived from this module's own location rather than
 * hardcoded, so it's independent of the repo name / checkout path: env.ts lives
 * at <repo>/setup-wizard/{src,dist}/env.* , and the bridge is <repo>/claude-slack-bot.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BRIDGE_DIR = path.resolve(MODULE_DIR, "..", "..", "claude-slack-bot");

/** Are we actually inside the Codespace desktop (vs. a dev machine)? */
export const inDesktop = process.platform === "linux" && existsSync(CHROME);

/**
 * Run a command, streaming its output to the terminal. Use for long or
 * interactive commands (installs, `git clone`, `claude` itself).
 */
export function run(
  cmd: string,
  args: string[] = [],
  opts: Options = {},
): ResultPromise {
  return execa(cmd, args, { stdio: "inherit", ...opts });
}

/**
 * Run a command and capture stdout (trimmed). Throws on non-zero exit unless
 * `reject: false` is passed.
 */
export async function capture(
  cmd: string,
  args: string[] = [],
  opts: Options = {},
): Promise<string> {
  const res = await execa(cmd, args, { stdio: "pipe", ...opts });
  return typeof res.stdout === "string" ? res.stdout.trim() : "";
}

/** True if a binary is resolvable on PATH. */
export async function which(bin: string): Promise<boolean> {
  try {
    await execa("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * True unless CLAUDE_CHROME is explicitly off. Mirrors the bridge's _truthy
 * (app.py / bridge.py): default ON, disabled by anything not in the
 * truthy set (0/false/no/off/…). Kept in sync so the wizard's smoke test and
 * the running bot agree on whether the Claude-in-Chrome MCP is enabled.
 */
function chromeEnabled(): boolean {
  const v = (process.env.CLAUDE_CHROME ?? "1").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

/** Read a single KEY from the bot's bridge .env, or undefined if absent. */
function readBridgeEnv(key: string): string | undefined {
  try {
    const file = path.join(BRIDGE_DIR, ".env");
    if (!existsSync(file)) return undefined;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let k = line.slice(0, eq).trim();
      if (k.startsWith("export ")) k = k.slice("export ".length).trim();
      if (k !== key) continue;
      let v = line.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Tell Central the agent is authenticated and the teammate is usable, so the
 * dashboard drops its "Set up in VS Code" prompt. Endpoint + bearer come from
 * the bridge .env Central provisioned (CENTRAL_TOKEN_URL / CENTRAL_PULL_SECRET);
 * the agent-ready route sits next to the token route. Best-effort + no-op when
 * those aren't present (e.g. local dev) — the dashboard just flips on a later run.
 */
export async function reportAgentReady(): Promise<boolean> {
  const tokenUrl = readBridgeEnv("CENTRAL_TOKEN_URL");
  const secret = readBridgeEnv("CENTRAL_PULL_SECRET");
  if (!tokenUrl || !secret) return false;
  const url = tokenUrl.replace("/github-token", "/agent-ready");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Load the Anthropic API key the auth step persisted into the bridge .env back
 * into this process's env, if it isn't already set. The wizard is launched by
 * the VS Code task's NON-interactive bash, which doesn't source ~/.bashrc — so
 * on a fresh/resumed run process.env can lack ANTHROPIC_API_KEY even though the
 * key was saved in a prior session. Call once at startup so the wizard (and
 * every `claude` it spawns) is authenticated the same way a hand-run `claude`
 * (which DOES source ~/.bashrc) is. Returns true if a key is now present.
 */
export function hydrateApiKey(): boolean {
  if (!process.env.ANTHROPIC_API_KEY) {
    const fromBridge = readBridgeEnv("ANTHROPIC_API_KEY");
    if (fromBridge) process.env.ANTHROPIC_API_KEY = fromBridge;
  }
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Spawn `claude`, forcing BROWSER to the desktop Chrome so its OAuth/login
 * links open where the user can see them, and (unless CLAUDE_CHROME is off)
 * passing `--chrome` so the Claude-in-Chrome browser MCP is actually loaded —
 * without it Claude has no browser-control tools. The image's bashrc shim sets
 * BROWSER for interactive shells, but child processes don't inherit shell
 * functions, so we set both explicitly here.
 *
 * Also injects ANTHROPIC_API_KEY from the bridge .env when it isn't already in
 * the environment — the wizard's launching shell is non-interactive and doesn't
 * source ~/.bashrc, so without this a spawned claude can be unauthenticated even
 * though a hand-run claude works.
 */
export function claude(args: string[] = [], opts: Options = {}): ResultPromise {
  // Always run with auto permission mode so the agent isn't blocked on tool
  // approvals (the headless smoke test can't answer prompts, and the demo/setup
  // runs should just proceed). Matches the bridge's CLAUDE_PERMISSION_MODE.
  const finalArgs = [
    "--permission-mode=auto",
    ...(chromeEnabled() ? ["--chrome"] : []),
    ...args,
  ];
  const apiKey = process.env.ANTHROPIC_API_KEY ?? readBridgeEnv("ANTHROPIC_API_KEY");
  return run("claude", finalArgs, {
    ...opts,
    env: {
      ...process.env,
      BROWSER: CHROME,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      ...(opts.env ?? {}),
    },
  });
}

/**
 * Open a URL in the desktop Chrome (or the host browser when developing off
 * the Codespace). Fire-and-forget — never blocks the wizard.
 *
 * Notes that bit us before:
 *  - $BROWSER is deliberately ignored on Linux: VS Code overrides it with a
 *    helper that opens links on the *client* machine, not the in-codespace
 *    desktop the user is viewing over KasmVNC.
 *  - DISPLAY must point at the desktop X server (:1). It's set via containerEnv
 *    for normal shells, but can be missing when the wizard runs over
 *    `gh codespace ssh`, so default it here.
 *  - execa() reports a bad binary asynchronously, so we existsSync() the Chrome
 *    wrapper instead of relying on a try/catch around a detached spawn.
 */
export async function openUrl(url: string): Promise<void> {
  // macOS dev convenience.
  if (process.platform === "darwin") {
    execa("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ":1" };

  // In the Codespace desktop, force the sandbox-disabled Chrome wrapper.
  if (existsSync(CHROME)) {
    execa(CHROME, [url], { detached: true, stdio: "ignore", env }).unref();
    return;
  }

  // Fallback for non-desktop Linux.
  execa("xdg-open", [url], { detached: true, stdio: "ignore", env }).unref();
}

/**
 * Launch the desktop Chrome with no URL (a blank window), so it's already open
 * on the desktop by the time the user reaches the extension-install step.
 * Codespace-desktop only; fire-and-forget. Same DISPLAY/wrapper handling as
 * openUrl. Returns false if there's no desktop Chrome to launch.
 */
export function launchChrome(): boolean {
  if (!existsSync(CHROME)) return false;
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ":1" };
  execa(CHROME, [], { detached: true, stdio: "ignore", env }).unref();
  return true;
}

/** True if a desktop Chrome process is already running. */
export async function chromeRunning(): Promise<boolean> {
  try {
    await execa("pgrep", ["-f", "google-chrome"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
