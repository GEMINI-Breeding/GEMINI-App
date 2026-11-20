"""The local map-tile forwarder adds the session's token once (gemi_agent.tile_proxy)."""
import os
import sys
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gemi_agent.tile_proxy import make_handler, target_path  # noqa: E402

PREFIX = "/abcdefghijklmnopqrstuvwx"


class Upstream(BaseHTTPRequestHandler):
    """Answers only under the token, like hpc/remote/titiler_guard.py."""

    def do_GET(self):  # noqa: N802
        ok = self.path.startswith(PREFIX + "/")
        body = self.path.encode() if ok else b"not found"
        self.send_response(200 if ok else 404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serve(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class TileProxyTest(unittest.TestCase):
    def test_target_path(self):
        self.assertEqual(target_path("/cog/info?url=x", PREFIX), PREFIX + "/cog/info?url=x")
        self.assertEqual(target_path(PREFIX + "/cog/tiles/1/2/3", PREFIX), PREFIX + "/cog/tiles/1/2/3")
        self.assertEqual(target_path("healthz", PREFIX), PREFIX + "/healthz")
        # Only a whole path segment counts as the token.
        self.assertEqual(target_path(PREFIX + "x/a", PREFIX), PREFIX + PREFIX + "x/a")

    def test_forwards_with_token(self):
        up = serve(Upstream)
        proxy = serve(make_handler(up.server_address[1], PREFIX))
        base = f"http://127.0.0.1:{proxy.server_address[1]}"
        try:
            with urllib.request.urlopen(base + "/cog/info?url=s3://b/x.tif") as r:
                self.assertEqual(r.read().decode(), PREFIX + "/cog/info?url=s3://b/x.tif")
            with urllib.request.urlopen(base + PREFIX + "/cog/tiles/1/2/3") as r:
                self.assertEqual(r.read().decode(), PREFIX + "/cog/tiles/1/2/3")
        finally:
            proxy.shutdown()
            up.shutdown()


if __name__ == "__main__":
    unittest.main()
