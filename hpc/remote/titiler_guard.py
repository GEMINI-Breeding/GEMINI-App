"""The session's TiTiler, answering only under a secret path prefix.

TiTiler has no sign-in of its own, holds the storage keys, and has to listen
on the node's network address (the tunnel reaches it from the login node). Run
plainly, anyone on the cluster who found its port could read every map in the
session. This wrapper serves TiTiler only under /<GEMI_TILE_TOKEN>/, a random
value made at each core start and kept in run/session.env (owner-only, or the
group's when the session is shared). Every other path gets 404.

The prefix is set as the ASGI root_path, so URLs TiTiler writes into its
responses (tilejson "tiles") carry it too. Run with
`uvicorn titiler_guard:app` (core.sbatch mounts this file into the image).
"""
import hmac
import os

from titiler.application.main import app as titiler

_TOKEN = os.environ["GEMI_TILE_TOKEN"]
if len(_TOKEN) < 16:
    raise SystemExit("GEMI_TILE_TOKEN is too short")
PREFIX = "/" + _TOKEN


def _allowed(path: str) -> bool:
    head = path[: len(PREFIX)]
    return hmac.compare_digest(head, PREFIX) and (len(path) == len(PREFIX) or path[len(PREFIX)] == "/")


async def _not_found(send) -> None:
    await send({"type": "http.response.start", "status": 404,
                "headers": [(b"content-type", b"text/plain"), (b"content-length", b"9")]})
    await send({"type": "http.response.body", "body": b"not found"})


async def app(scope, receive, send):
    if scope["type"] in ("http", "websocket"):
        if not _allowed(scope.get("path", "")):
            if scope["type"] == "http":
                await _not_found(send)
            return
        # Starlette routes on the path minus root_path, and writes root_path into
        # the URLs it builds.
        scope = dict(scope, root_path=scope.get("root_path", "") + PREFIX)
    await titiler(scope, receive, send)
