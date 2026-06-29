import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Claude Code's USER settings file. permissions.defaultMode set here applies to
// every `claude` run in this codespace.
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

type Settings = {
  permissions?: { defaultMode?: string } & Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Ensure Claude Code defaults its permission mode (e.g. "auto") so a plain
 * `claude` in this codespace isn't blocked on tool approvals — matching how the
 * bridge and the wizard fork it.
 *
 * Must be USER scope (~/.claude/settings.json): Claude Code ignores
 * defaultMode:"auto" set in project-scoped .claude/settings*.json files. Merges
 * into any existing settings, preserving other keys. Idempotent — no write when
 * it's already set. Returns whether the file was changed.
 */
export function ensureClaudeDefaultMode(mode = "auto"): { changed: boolean } {
  let settings: Settings = {};
  if (existsSync(SETTINGS)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as Settings;
    } catch {
      // Don't clobber a settings file we can't parse.
      return { changed: false };
    }
  }
  const perms = (settings.permissions ??= {});
  if (perms.defaultMode === mode) return { changed: false };
  perms.defaultMode = mode;
  mkdirSync(path.dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return { changed: true };
}
