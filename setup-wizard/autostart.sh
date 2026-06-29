#!/usr/bin/env bash
# Launched by VS Code (.vscode/tasks.json, runOn: folderOpen) when this codespace
# is opened in the editor. Installs the wizard's deps on first run, then starts
# it in auto mode. In auto mode the wizard no-ops once every step is complete,
# so this is harmless to run on every open.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing setup-wizard dependencies (first run)…"
  npm install
fi

export CODERBOTS_AUTOSTART=1
# Run the wizard. Don't `exec` it: when it finishes we want to KEEP this
# terminal open (so its final output/instructions stay on screen and you have a
# ready shell), rather than letting the VS Code task terminal close. `|| true`
# so a non-zero exit doesn't abort before we hand off to the shell.
npm run dev || true

# Hand the panel over to an interactive login shell so the terminal stays open
# and usable in the workspace directory after setup.
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$HOME")"
exec bash -l
