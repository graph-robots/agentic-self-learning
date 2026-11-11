# SPDX-License-Identifier: Apache-2.0
import json
import stat

from asl.agent import make_agent
from asl.codex import CodexAgent, audit_offlimits, parse_events
from asl.config import load_config

from .conftest import ROOT

FAKE = """#!/usr/bin/env python3
import json, pathlib, sys
args = sys.argv[1:]
log = pathlib.Path(__file__).with_suffix(".calls")
calls = json.loads(log.read_text()) if log.exists() else []
calls.append(args)
log.write_text(json.dumps(calls))
pathlib.Path("workflow").mkdir(exist_ok=True)
pathlib.Path("workflow/workflow.json").write_text(json.dumps({"call": len(calls)}))
events = [
    {"type": "thread.started", "thread_id": "t-1"},
    {"type": "item.completed", "item": {"type": "command_execution", "command": "./validate.sh"}},
    {"type": "item.completed", "item": {"type": "agent_message", "text": "I changed the grasp."}},
    {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 7}},
]
print("\\n".join(json.dumps(e) for e in events))
"""


def _cfg(tmp_path, *extra):
    fake = tmp_path / "codex"
    fake.write_text(FAKE)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return load_config(
        ROOT / "examples" / "cube_in_tray" / "configs" / "codex.yaml",
        [f"agent.codex_binary={fake}", f"workspace_root={tmp_path / 'ws'}", f"out_root={tmp_path / 'out'}", *extra],
    ), fake


def test_codex_session_starts_then_resumes_by_thread(tmp_path):
    cfg, fake = _cfg(tmp_path)
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = make_agent(cfg, run_dir)
    assert isinstance(agent, CodexAgent)
    agent.prepare(None, "write it", None)
    rules = (agent.workspace / "AGENTS.md").read_text()
    assert str(run_dir.resolve()) in rules and "OFF LIMITS" in rules
    first = agent.call(tmp_path / "a0")
    agent.prepare(agent.workspace / "workflow", "improve it", "# feedback")
    second = agent.call(tmp_path / "a1")
    calls = json.loads(fake.with_suffix(".calls").read_text())
    assert calls[0][0] == "exec" and "resume" not in calls[0]
    assert calls[1][:2] == ["exec", "resume"] and "t-1" in calls[1]
    assert 'sandbox_mode="workspace-write"' in calls[0] and "gpt-6-astra" in calls[0]
    assert 'model_reasoning_effort="xhigh"' in calls[0]
    assert first.summary == "I changed the grasp." and first.turns == 1 and first.usd == 0.0
    assert first.tokens == {"input": 100, "cached_input": 40, "output": 7} and second.changed
    state = json.loads((run_dir / "agent_session.json").read_text())
    assert state["session_id"] == "t-1" and state["tokens"]["input"] == 200


def test_the_audit_flags_what_the_session_did_not_what_it_read(tmp_path):
    secret = tmp_path / "held_out"
    events = [
        {"type": "item.completed", "item": {"type": "command_execution", "command": f"cat {secret}/x.json",
                                            "aggregated_output": "..."}},
        {"type": "item.completed", "item": {"type": "command_execution", "command": "cat AGENTS.md",
                                            "aggregated_output": f"do not read {secret}"}},
        {"type": "item.completed", "item": {"type": "file_change", "changes": [{"path": f"{secret}/y"}]}},
    ]
    hits = audit_offlimits(events, [secret])
    assert [h["item_type"] for h in hits] == ["command_execution", "file_change"]
    summary, commands, tokens, thread = parse_events(events)
    assert (summary, commands, thread) == ("", 2, "")
