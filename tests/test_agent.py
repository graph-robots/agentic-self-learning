# SPDX-License-Identifier: Apache-2.0
import json
import stat
import subprocess

import pytest

from asl.agent import Agent, AgentError, tools_markdown
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
print(json.dumps({"result": "edited", "total_cost_usd": 1.5 * len(calls), "num_turns": 3, "session_id": "s-1"}))
"""


def test_resumed_session_costs_the_difference(tmp_path):
    fake = tmp_path / "claude"
    fake.write_text(FAKE)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    cfg = load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml",
        [f"agent.claude_binary={fake}", f"workspace_root={tmp_path / 'ws'}", f"out_root={tmp_path / 'out'}"],
    )
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(cfg, run_dir)
    agent.prepare(None, "write it", None)
    assert not (agent.workspace / "FEEDBACK.md").exists()
    deny = json.loads((agent.workspace / ".claude" / "settings.json").read_text())["permissions"]["deny"]
    assert any(str(run_dir.resolve()).lstrip("/") in rule for rule in deny)
    first = agent.call(tmp_path / "a0")
    agent.prepare(agent.workspace / "workflow", "improve it", "# feedback")
    second = agent.call(tmp_path / "a1")
    calls = json.loads(fake.with_suffix(".calls").read_text())
    assert "--session-id" in calls[0] and calls[1][calls[1].index("--resume") + 1] == "s-1"
    assert (first.usd, second.usd) == (1.5, 1.5)
    assert first.changed and second.changed
    assert (agent.workspace / "FEEDBACK.md").read_text() == "# feedback"
    # A second Agent on the same run picks the session up where it was.
    assert Agent(cfg, run_dir).reported_usd == 3.0


def test_tools_markdown_lists_every_tool():
    text = tools_markdown(ROOT / "examples" / "cube_in_tray" / "tools.json")
    doc = json.loads((ROOT / "examples" / "cube_in_tray" / "tools.json").read_text())
    for tool in doc["tools"]:
        assert f"## `{tool['name']}(" in text


def test_thinking_budget_and_env_reach_the_session(tmp_path, monkeypatch):
    fake = tmp_path / "claude"
    fake.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, pathlib\n"
        "pathlib.Path('env.json').write_text(json.dumps({k: os.environ.get(k) for k in ('MAX_THINKING_TOKENS', 'ANTHROPIC_BASE_URL', 'MY_TOKEN')}))\n"
        "print(json.dumps({'result': 'ok', 'total_cost_usd': 0.1, 'num_turns': 1, 'session_id': 's'}))\n"
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("SECRET_FOR_TEST", "abc")
    cfg = load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml",
        [
            f"agent.claude_binary={fake}", f"workspace_root={tmp_path / 'ws'}", f"out_root={tmp_path / 'out'}",
            "agent.thinking_tokens=4000", "agent.env.ANTHROPIC_BASE_URL=https://example.invalid",
            "agent.env.MY_TOKEN=$SECRET_FOR_TEST",
        ],
    )
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(cfg, run_dir)
    agent.prepare(None, "write it", None)
    agent.call(tmp_path / "a0")
    seen = json.loads((agent.workspace / "env.json").read_text())
    assert seen == {"MAX_THINKING_TOKENS": "4000", "ANTHROPIC_BASE_URL": "https://example.invalid", "MY_TOKEN": "abc"}
    # the config keeps the reference, not the secret
    assert cfg.agent.env["MY_TOKEN"] == "$SECRET_FOR_TEST"


def test_frames_reach_the_workspace_and_leave_it_again(tmp_path):
    cfg = load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml",
        [f"workspace_root={tmp_path / 'ws'}", f"out_root={tmp_path / 'out'}"],
    )
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    frames = tmp_path / "k000" / "frames"
    frames.mkdir(parents=True)
    (frames / "e0_x.png").write_bytes(b"png")
    agent = Agent(cfg, run_dir)
    agent.prepare(None, "improve it", "# feedback", frames)
    assert (agent.workspace / "frames" / "e0_x.png").is_file()
    assert "`frames/`" in (agent.workspace / "INSTRUCTIONS.md").read_text()
    agent.prepare(None, "improve it", "# feedback", None)
    assert not (agent.workspace / "frames").exists()


def _example(tmp_path, *extra):
    return load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml",
        [f"workspace_root={tmp_path / 'ws'}", f"out_root={tmp_path / 'out'}", *extra],
    )


def test_the_session_may_not_rewrite_its_check_or_rules_nor_read_the_example(tmp_path):
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(_example(tmp_path), run_dir)
    agent.prepare(None, "write it", None)
    deny = json.loads((agent.workspace / ".claude" / "settings.json").read_text())["permissions"]["deny"]
    ws = str(agent.workspace.resolve()).lstrip("/")
    for tool in ("Edit", "Write"):
        assert f"{tool}(//{ws}/validate.sh)" in deny and f"{tool}(//{ws}/.claude/**)" in deny
    # The example's own directory holds a solved policy and a README that states the goal.
    example = str((ROOT / "examples" / "cube_in_tray").resolve()).lstrip("/")
    assert f"Read(//{example}/**)" in deny
    assert f"Read(//{str((ROOT / 'tests' / 'fixtures').resolve()).lstrip('/')}/**)" in deny


def test_validate_sh_runs_no_code_the_session_wrote(tmp_path):
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(_example(tmp_path), run_dir)
    agent.prepare(ROOT / "examples" / "cube_in_tray" / "policy", "improve it", "# feedback")
    ws = agent.workspace
    mark = tmp_path / "ran"
    plant = f"open({str(mark)!r}, 'a').write(__name__ + '\\n')\n"
    # A policy script that would rewrite the check when imported, and files that would stand in for modules.
    find = next((ws / "workflow" / "scripts").rglob("*.py"))
    find.write_text(plant + "open('validate.sh', 'w').write('echo rewritten')\n" + find.read_text())
    (ws / "json.py").write_text(plant)
    (ws / "asl").mkdir()
    (ws / "asl" / "__init__.py").write_text(plant)
    script = (ws / "validate.sh").read_text()
    for _ in range(2):
        proc = subprocess.run(["./validate.sh"], cwd=ws, capture_output=True, text=True, check=False)
        assert proc.returncode == 0 and proc.stdout.strip() == "OK", proc.stdout + proc.stderr
    assert not mark.exists()
    assert (ws / "validate.sh").read_text() == script


def test_runs_sharing_a_directory_name_get_their_own_workspaces(tmp_path):
    cfg = _example(tmp_path)
    a, b = tmp_path / "out" / "motion" / "20261022_101500", tmp_path / "out" / "visual" / "20261022_101500"
    a.mkdir(parents=True)
    b.mkdir(parents=True)
    first = Agent(cfg, a)
    assert first.workspace != Agent(cfg, b).workspace
    first._save_state()
    assert Agent(cfg, a).workspace == first.workspace


def test_a_fix_round_before_any_feedback_says_what_workflow_holds(tmp_path):
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    rejected = tmp_path / "rejected"
    (rejected / "scripts").mkdir(parents=True)
    (rejected / "workflow.json").write_text("{}")
    agent = Agent(_example(tmp_path), run_dir)
    agent.prepare(rejected, "fix it", None)
    text = (agent.workspace / "INSTRUCTIONS.md").read_text()
    assert "It is empty" not in text and "It holds the policy the check refused" in text
    agent.prepare(None, "write it", None)
    assert "It is empty" in (agent.workspace / "INSTRUCTIONS.md").read_text()


def test_a_timed_out_call_keeps_its_output_and_raises(tmp_path):
    fake = tmp_path / "claude"
    fake.write_text("#!/usr/bin/env python3\nimport sys, time\nprint('partial', flush=True)\ntime.sleep(30)\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(_example(tmp_path, f"agent.claude_binary={fake}", "agent.timeout_s=1"), run_dir)
    agent.prepare(None, "write it", None)
    with pytest.raises(AgentError, match="did not finish"):
        agent.call(tmp_path / "a0")
    assert (tmp_path / "a0" / "stdout.json").read_text() == "partial\n"


def test_each_calls_token_counts_are_kept(tmp_path):
    fake = tmp_path / "claude"
    usage = {"input_tokens": 10, "cache_creation_input_tokens": 200, "cache_read_input_tokens": 3000, "output_tokens": 40}
    fake.write_text(
        "#!/usr/bin/env python3\nimport json\n"
        f"print(json.dumps({{'result': 'ok', 'total_cost_usd': 0.1, 'num_turns': 1, 'session_id': 's', 'usage': {usage!r}}}))\n"
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    run_dir = tmp_path / "out" / "run"
    run_dir.mkdir(parents=True)
    agent = Agent(_example(tmp_path, f"agent.claude_binary={fake}"), run_dir)
    agent.prepare(None, "write it", None)
    result = agent.call(tmp_path / "a0")
    assert result.tokens == {"input": 10, "cache_creation_input": 200, "cache_read_input": 3000, "output": 40}
