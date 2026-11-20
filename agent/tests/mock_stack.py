"""A stand-in for the model endpoint and the few REST calls the agent service
makes, so the loop and the service can be tested with nothing else running.

    python tests/mock_stack.py [port]      # serves until killed

Model: a scripted "assistant" that lists the skills, reads one, tries a
delete (to exercise approvals) and then answers. It replies in whichever
tool style the request uses (native `tools`, or the text JSON protocol).
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = [
    ("skills", {}),
    ("read_skill", {"name": "monitor-jobs"}),
    ("delete_job", {"job_id": "job-123"}),
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/users/me"):
            ok = self.headers.get("Authorization") == "Bearer test-token"
            return self._send(200 if ok else 401, {"email": "tester@example.com", "is_superuser": True} if ok else {})
        if self.path.startswith("/api/jobs/all"):
            return self._send(200, [])
        if self.path.startswith("/api/experiments/all"):
            return self._send(200, [{"id": "e1", "experiment_name": "DEMO"}])
        self._send(404, {})

    def do_DELETE(self):
        self._send(200, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if not self.path.endswith("/chat/completions"):
            return self._send(404, {})
        msgs = body["messages"]
        # How many tool results has the conversation seen so far?
        done = sum(1 for m in msgs if m["role"] == "tool" or
                   (m["role"] == "user" and isinstance(m["content"], str) and m["content"].startswith("TOOL RESULT")))
        if len(msgs) == 1 or (len(msgs) == 2 and "single word" in str(msgs[-1]["content"])):
            return self._send(200, {"choices": [{"message": {"role": "assistant", "content": "ready"}}]})
        if done < len(SCRIPT):
            name, args = SCRIPT[done]
            if body.get("tools"):
                msg = {"role": "assistant", "content": None, "tool_calls": [
                    {"id": f"call_{done}", "type": "function",
                     "function": {"name": name, "arguments": json.dumps(args)}}]}
            else:
                text = json.dumps({"tool": name, "args": args})
                msg = {"role": "assistant", "content": f"```json\n{text}\n```" if done % 2 else text}
        else:
            last = msgs[-1]["content"]
            msg = {"role": "assistant", "content": f"Done. Last tool said: {str(last)[:60]}"}
        self._send(200, {"choices": [{"message": msg}]})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
