# SPDX-License-Identifier: Apache-2.0
import json

from asl.check import check_workflow, load_tools

from .conftest import ROOT

TOOLS = load_tools(ROOT / "examples" / "cube_in_tray" / "tools.json")


def _policy(tmp_path, script: str, tool_node: str = "robot.open_gripper", tool_inputs=None):
    wf = {
        "version": 3,
        "nodes": {
            "a": {"type": "subgraph", "ref": "a_sg"},
            "done": {"type": "end", "status": "success"},
            "abort": {"type": "end", "status": "failure"},
        },
        "edges": [["START", "a"]],
        "conditional_edges": {"a": {"router_field": "exit", "mapping": {"ok": "done", "failed": "abort"}}},
        "subgraphs": {
            "a_sg": {
                "skill": "generated",
                "inputs": {},
                "outputs": {},
                "nodes": {
                    "open": {"type": "tool", "tool": tool_node, "inputs": tool_inputs or {"settle_steps": 10}},
                    "go": {"type": "script", "script": "scripts/go.py"},
                    "ok": {"type": "noop"},
                },
                "edges": [["START", "open"], ["open", "go"], ["go", "ok"], ["ok", "END"]],
                "conditional_edges": {},
                "exit": {"router_field": None, "success_values": ["ok"]},
                "on_error": "failed",
            }
        },
    }
    (tmp_path / "scripts").mkdir(parents=True)
    (tmp_path / "workflow.json").write_text(json.dumps(wf))
    (tmp_path / "scripts" / "go.py").write_text(script)
    return tmp_path


GOOD = """
def run(ctx):
    pose = ctx.tool("sim.get_object_pose", object_name="cube")["pose"]
    ctx.tool("robot.go_to_pose", pose=pose)
    return {}
"""


def test_clean_policy(tmp_path):
    assert check_workflow(_policy(tmp_path, GOOD), TOOLS, run_gap=False) == []


def test_tool_not_allowed(tmp_path):
    errors = check_workflow(
        _policy(tmp_path, GOOD, tool_node="sim.check_success", tool_inputs={}), TOOLS, run_gap=False
    )
    assert any("`sim.check_success` is not an allowed tool" in e for e in errors)


def test_script_tool_not_allowed_and_dynamic(tmp_path):
    script = 'def run(ctx):\n    ctx.tool("sim.query", atom="on")\n    name = "robot.go_home"\n    ctx.tool(name)\n'
    errors = check_workflow(_policy(tmp_path, script), TOOLS, run_gap=False)
    assert any("go.py:2: `sim.query` is not an allowed tool" in e for e in errors)
    assert any("go.py:4: ctx.tool needs a literal tool name" in e for e in errors)


def test_unknown_argument(tmp_path):
    script = 'def run(ctx):\n    ctx.tool("robot.close_gripper", width=0.02)\n'
    errors = check_workflow(_policy(tmp_path, script), TOOLS, run_gap=False)
    assert any("`robot.close_gripper` takes no argument(s) ['width']" in e for e in errors)


def test_missing_script_and_syntax(tmp_path):
    policy = _policy(tmp_path, "def run(ctx:\n")
    errors = check_workflow(policy, TOOLS, run_gap=False)
    assert any("syntax error" in e for e in errors)
    (policy / "scripts" / "go.py").unlink()
    assert any("does not exist" in e for e in check_workflow(policy, TOOLS, run_gap=False))


def test_deliver_keeps_only_used_files(tmp_path):
    from asl.loop import deliver

    policy = _policy(tmp_path / "wf", "from helpers import lift\n\ndef run(ctx):\n    return lift(ctx)\n")
    (policy / "scripts" / "helpers.py").write_text("def lift(ctx):\n    return {}\n")
    (policy / "scripts" / "unused.py").write_text("x = 1\n")
    (policy / "_mock_test.py").write_text("")
    copied = deliver(policy, tmp_path / "out")
    assert sorted(copied) == ["scripts/go.py", "scripts/helpers.py", "workflow.json"]
    assert not (tmp_path / "out" / "_mock_test.py").exists()


def test_a_registry_skill_label_is_refused(tmp_path):
    root = _policy(tmp_path, GOOD)
    doc = json.loads((root / "workflow.json").read_text())
    doc["subgraphs"]["a_sg"]["skill"] = "placing-held-feature"
    (root / "workflow.json").write_text(json.dumps(doc))
    errors = check_workflow(root, TOOLS, run_gap=False)
    assert any("names a registry skill" in e for e in errors)


def test_edit_size_counts_graph_dataflow_and_lines(tmp_path):
    from asl.check import edit_size

    before = _policy(tmp_path / "a", GOOD)
    after = _policy(tmp_path / "b", GOOD + "\n# one more line\n")
    doc = json.loads((after / "workflow.json").read_text())
    doc["subgraphs"]["a_sg"]["nodes"]["open"]["inputs"] = {"settle_steps": 20}
    doc["subgraphs"]["a_sg"]["nodes"]["wait"] = {"type": "noop"}
    (after / "workflow.json").write_text(json.dumps(doc))
    size = edit_size(before, after)
    assert size["nodes_added"] == 1 and size["bindings_changed"] == 1
    assert size["scripts_changed"] == 1 and size["loc_delta"] == 2
    assert edit_size(before, before) == dict.fromkeys(size, 0)


def test_the_check_runs_none_of_the_policy(tmp_path):
    mark = tmp_path / "ran"
    script = f"open({str(mark)!r}, 'w').write('ran')\nraise SystemExit(3)\n" + GOOD
    assert check_workflow(_policy(tmp_path / "wf", script), TOOLS) == []
    assert not mark.exists()


def test_a_malformed_workflow_is_reported_not_raised(tmp_path):
    from asl.check import edit_size

    good = _policy(tmp_path / "good", GOOD)
    shapes = {
        "list": [1, 2],
        "nodes_list": {"nodes": [{"type": "end"}]},
        "node_str": {"nodes": {"a": "end"}},
        "subgraph_str": {"subgraphs": {"s": "x"}},
        "edges_str": {"nodes": {}, "edges": ["START->a"], "conditional_edges": {"a": ["x"]}},
        "recovery_str": {"nodes": {"a": {"type": "tool", "tool": "robot.go_home", "recovery": "retry"}}},
    }
    for name, doc in shapes.items():
        bad = tmp_path / name
        bad.mkdir()
        (bad / "workflow.json").write_text(json.dumps(doc))
        assert isinstance(check_workflow(bad, TOOLS, run_gap=False), list), name
        # The history table measures a rejected edit against the last good policy.
        assert set(edit_size(good, bad)) == set(edit_size(good, good)), name
    assert check_workflow(tmp_path / "list", TOOLS, run_gap=False) == ["workflow.json must be a JSON object, got list"]


def test_a_script_outside_the_policy_is_refused_and_not_delivered(tmp_path):
    from asl.loop import deliver

    workspace = tmp_path / "ws"
    (workspace / "skills" / "demo" / "scripts").mkdir(parents=True)
    (workspace / "skills" / "demo" / "scripts" / "find.py").write_text(GOOD)
    policy = _policy(workspace / "workflow", GOOD)
    doc = json.loads((policy / "workflow.json").read_text())
    doc["subgraphs"]["a_sg"]["nodes"]["go"]["script"] = "../skills/demo/scripts/find.py"
    (policy / "workflow.json").write_text(json.dumps(doc))
    errors = check_workflow(policy, TOOLS, run_gap=False)
    assert any("../skills/demo/scripts/find.py is outside the policy's directory" in e for e in errors)
    assert deliver(policy, tmp_path / "out" / "policy") == ["workflow.json"]
    assert not (tmp_path / "out" / "skills").exists()
