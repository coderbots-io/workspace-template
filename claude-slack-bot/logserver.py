"""WebSocket log streamer (in-codespace sidecar).

Streams the bridge's live log over a WebSocket so Central's per-teammate "Logs"
page can watch it in real time. It tails bridge.log — the file supervisord
captures bridge.py's stdout/stderr into, which holds both the bridge's own
output and the per-session agent logs — and pushes each new line to connected
clients, after a short backfill of recent lines so the page opens with context.

Run:  uv run python logserver.py  (normally started by supervisord)

Reachability: Central reaches this over the codespace's PRIVATE forwarded port
(8787, declared in .devcontainer/devcontainer.json — see the note there). GitHub's
port-forwarding edge already gates private ports: only a request carrying an
`X-Github-Token` for a principal with access to this codespace gets through, so
the stream is never exposed to the public internet. Central proxies the browser
to here, attaching that header server-side (the browser can't set it). Given the
edge gate, this server adds no auth of its own.

Endpoints:
  GET /        plain-text health check ("logserver ok")
  GET /logs    WebSocket; server -> client text frames, one per log line
"""

from __future__ import annotations

import asyncio
import logging
import os

from aiohttp import WSMsgType, web

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("logserver")

HERE = os.path.dirname(os.path.abspath(__file__))
# Tail bridge.log by default. logserver's OWN output goes to logserver.log (see
# supervisord.conf) so streaming it doesn't echo this server's connect/disconnect
# lines back into the feed.
LOG_PATH = os.getenv("LOGSERVER_FILE", os.path.join(HERE, "bridge.log"))
PORT = int(os.getenv("LOGSERVER_PORT", "8787"))
BACKFILL_LINES = int(os.getenv("LOGSERVER_BACKFILL", "200"))
POLL_SECS = 0.5


def read_tail(path: str, n: int) -> list[str]:
    """Best-effort last `n` lines of `path`, newline-stripped. Empty if missing."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            # 256 KiB from the end is plenty for a few hundred log lines.
            chunk = min(size, 256 * 1024)
            f.seek(size - chunk)
            data = f.read()
    except FileNotFoundError:
        return []
    return data.decode("utf-8", "replace").splitlines()[-n:]


async def health(request: web.Request) -> web.Response:
    return web.Response(text="logserver ok\n")


async def stream(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    log.info("client connected from %s", request.remote)

    # Backfill recent lines so the page isn't blank until something new is logged.
    for line in read_tail(LOG_PATH, BACKFILL_LINES):
        await ws.send_str(line)

    async def tail() -> None:
        """Follow the file like `tail -f`, reopening on rotation/truncation
        (supervisord rotates bridge.log at 10 MB)."""
        f = None
        inode = None
        try:
            while not ws.closed:
                try:
                    st = os.stat(LOG_PATH)
                except FileNotFoundError:
                    await asyncio.sleep(POLL_SECS)
                    continue
                if f is None or st.st_ino != inode:
                    if f is not None:
                        f.close()
                    f = open(LOG_PATH, "r", encoding="utf-8", errors="replace")
                    f.seek(0, os.SEEK_END)
                    inode = st.st_ino
                elif f.tell() > st.st_size:
                    # File was truncated in place — restart from the top.
                    f.seek(0)
                line = f.readline()
                if line:
                    await ws.send_str(line.rstrip("\n"))
                else:
                    await asyncio.sleep(POLL_SECS)
        finally:
            if f is not None:
                f.close()

    tail_task = asyncio.create_task(tail())
    try:
        # Drain inbound frames so a client close/error ends this handler promptly.
        async for msg in ws:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
                break
    finally:
        tail_task.cancel()
        try:
            await tail_task
        except asyncio.CancelledError:
            pass
    log.info("client disconnected")
    return ws


def main() -> None:
    app = web.Application()
    app.router.add_get("/", health)
    app.router.add_get("/logs", stream)
    log.info("logserver listening on :%d (file=%s)", PORT, LOG_PATH)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
