"""A local forwarder for the cluster session's map tiles.

The session's TiTiler answers only under a secret path prefix (hpc/remote/
titiler_guard.py). The desktop app asks a fixed address for tiles
(127.0.0.1:8191, frontend/src/lib/stack.ts) and does not know the prefix.
This forwarder listens there, adds the prefix, and passes each request on to
the ssh tunnel's local port. URLs TiTiler writes into its answers (tilejson)
already carry the prefix, so a path that starts with it is passed on as it is.

Listens on 127.0.0.1 only. Run as its own process by hpc_tools._connect:
`gemi_agent _tile_proxy <listen port> <tunnel port> <token>`.
"""
from __future__ import annotations

import http.client
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
       "transfer-encoding", "upgrade"}


def target_path(path: str, prefix: str) -> str:
    """The path TiTiler is asked for: the prefix added once."""
    if path == prefix or path.startswith(prefix + "/"):
        return path
    return prefix + (path if path.startswith("/") else "/" + path)


def make_handler(upstream_port: int, prefix: str):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _forward(self, body: bool) -> None:
            conn = http.client.HTTPConnection("127.0.0.1", upstream_port, timeout=120)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            try:
                conn.request(self.command, target_path(self.path, prefix), headers=headers)
                resp = conn.getresponse()
                data = resp.read()
            except OSError as e:
                self.send_error(502, f"map tile tunnel: {e}")
                return
            finally:
                conn.close()
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in HOP and k.lower() != "content-length":
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if body:
                self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            self._forward(True)

        def do_HEAD(self) -> None:  # noqa: N802
            self._forward(False)

        def log_message(self, *args) -> None:
            pass

    return Handler


def main(argv: list[str]) -> None:
    listen, upstream, prefix = int(argv[0]), int(argv[1]), "/" + argv[2].strip("/")
    ThreadingHTTPServer(("127.0.0.1", listen), make_handler(upstream, prefix)).serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
