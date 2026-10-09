from gemi_agent.runner import parse_text_call as p

assert p('call:read_skill{name: "upload-data"}call:jobs{status: "FAILED", limit: 5}') == ("read_skill", {"name": "upload-data"})
assert p('<|tool_call>call:jobs{"status": "FAILED", "limit": 5}<tool_call|>') == ("jobs", {"status": "FAILED", "limit": 5})
assert p("call:status{}") == ("status", {})
assert p('```json\n{"tool": "x", "args": {"a": 1}}\n```') == ("x", {"a": 1})
assert p('{"tool": "status", "args": {}}') == ("status", {})
assert p("The jobs are fine: none failed.") is None
assert p('call:upload{paths: ["G:/R"], date: "2026-09-17", dry_run: true}') == (
    "upload", {"paths": ["G:/R"], "date": "2026-09-17", "dry_run": True})
print("parse ok")
assert p('call:panorama(track: "Raw/x/", pass: "60", redetect: true)') == (
    "panorama", {"track": "Raw/x/", "pass": "60", "redetect": True})
assert p('call:upload(paths: ["H:/a b/c"], parallel: 4)\n') == ("upload", {"paths": ["H:/a b/c"], "parallel": 4})
print("paren ok")
assert p('call:{"tool": "hpc", "args": {"action": "status"}}call:{"tool": "process_runs", "args": {}}') == ("hpc", {"action": "status"})
print("call-json ok")
