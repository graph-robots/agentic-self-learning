# SPDX-License-Identifier: Apache-2.0
"""The loop end to end, with a fake agent and a runner that replays a recorded batch."""

import json
import shutil
from pathlib import Path

import asl.loop as loop_module
from asl.agent import AgentError, AgentResult
from asl.config import load_config
from asl.feedback.schema import FeedbackPacket
from asl.runner import episode_ids, read_batch

from .conftest import ROOT

POLICY = ROOT / "examples" / "cube_in_tray" / "policy"


class FakeAgent:
    """Writes the example policy, then changes one script argument each round."""

    def __init__(self, cfg, run_dir):
        self.workspace = Path(run_dir) / "_workspace"
        self.calls = 0
        self.seen: list[str | None] = []

    def prepare(self, workflow, instructions, feedback, frames=None):
        self.workspace.mkdir(parents=True, exist_ok=True)
        target = self.workspace / "workflow"
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(workflow or POLICY, target)
        self.seen.append(feedback)

    def call(self, out_dir):
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        self.calls += 1
        wf = self.workspace / "workflow" / "workflow.json"
        doc = json.loads(wf.read_text())
        node = next(iter(doc["subgraphs"].values()))["nodes"]
        first = next(n for n in node.values() if n.get("type") == "script")
        first.setdefault("inputs", {})["attempt"] = self.calls
        wf.write_text(json.dumps(doc, indent=1))
        return AgentResult(summary=f"edit number {self.calls}", usd=0.25, turns=2, changed=True)

    def archive(self, out_dir):
        pass


def _wire(tmp_path, batch_dir, monkeypatch, make_agent):
    """The example's config, with *make_agent* for the agent and every batch a replay of *batch_dir*."""

    def run_batch(cfg, graph_dir, episodes, out_dir, name, **kw):
        dest = Path(out_dir) / name
        shutil.copytree(batch_dir, dest, dirs_exist_ok=True)
        batch = read_batch(dest)
        batch.requested = len(episode_ids(episodes))
        return batch

    monkeypatch.setattr(loop_module, "make_agent", make_agent)
    monkeypatch.setattr(loop_module, "run_batch", run_batch)
    monkeypatch.setattr(loop_module, "check_workflow", lambda *a, **k: [])
    monkeypatch.setattr(loop_module, "_revision", lambda repo: "test")
    rss = tmp_path / "rss" / "scripts"
    rss.mkdir(parents=True)
    (rss / "bench_run.py").write_text("")
    return load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml",
        [f"rss_repo={tmp_path / 'rss'}", f"out_root={tmp_path / 'out'}", "loop.iterations=3", "train_episodes=0:1"],
    )


def test_the_loop_writes_packets_feedback_and_history(tmp_path, batch_dir, monkeypatch):
    agent = {}

    def make_agent(cfg, run_dir):
        agent["it"] = FakeAgent(cfg, run_dir)
        return agent["it"]

    cfg = _wire(tmp_path, batch_dir, monkeypatch, make_agent)
    report = loop_module.Loop(cfg, run_dir=tmp_path / "out" / "run").run()

    assert report["train_curve"] == [[0, 0, 1], [1, 0, 1], [2, 0, 1]]
    assert report["feedback"] == {"form": ["state", "relations"], "spatial": "parts", "granularity": "semantic"}
    k2 = tmp_path / "out" / "run" / "iterations" / "k002"
    packet = FeedbackPacket.model_validate_json((k2 / "feedback.json").read_text())
    assert [h.iteration for h in packet.history] == [0, 1]
    assert packet.history[1].change == "edit number 3" and packet.history[1].diff_stats["bindings_changed"] == 1
    # The batch ran out of steps with the graph still running: its node's error is not where the graph raised.
    assert packet.history[0].failure_stages == {"(out of steps)": 1}
    text = (k2 / "FEEDBACK.md").read_text()
    assert "What has been tried so far" in text and "edit number 3" in text
    # The agent read each FEEDBACK.md the loop wrote, and none before the first batch.
    assert agent["it"].seen[0] is None and agent["it"].seen[1] == (tmp_path / "out" / "run" / "iterations" / "k000" / "FEEDBACK.md").read_text()
    ledger = [json.loads(line) for line in (tmp_path / "out" / "run" / "ledger.jsonl").read_text().splitlines()]
    assert any(row["event"] == "warning" and "no asset declares a part" in row["message"] for row in ledger)


def test_an_agent_error_stops_the_run_and_delivers_what_was_scored(tmp_path, batch_dir, monkeypatch):
    class FailingAgent(FakeAgent):
        def call(self, out_dir):
            if self.calls == 1:
                raise AgentError("claude did not finish in 1 s")
            return super().call(out_dir)

    cfg = _wire(tmp_path, batch_dir, monkeypatch, FailingAgent)
    run = tmp_path / "out" / "run"
    report = loop_module.Loop(cfg, run_dir=run).run()
    assert report["stopped"] == "agent_error" and report["train_curve"] == [[0, 0, 1]]
    assert (run / "policy" / "workflow.json").is_file()
    assert json.loads((run / "report.json").read_text())["stopped"] == "agent_error"
    assert not (run / "_workspace").exists()
