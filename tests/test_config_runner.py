# SPDX-License-Identifier: Apache-2.0
import json

import pytest

from asl.config import load_config
from asl.runner import build_command, episode_ids, read_batch, run_batch

from .conftest import ROOT


def _rss(tmp_path):
    (tmp_path / "rss" / "scripts").mkdir(parents=True)
    (tmp_path / "rss" / "scripts" / "bench_run.py").write_text("")
    return tmp_path / "rss"


def test_example_config_resolves(tmp_path):
    cfg = load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml", [f"rss_repo={_rss(tmp_path)}", "loop.iterations=2"]
    )
    assert cfg.task_root == ROOT / "examples" / "cube_in_tray" / "tasks"
    assert cfg.tools.is_file()
    assert cfg.loop.iterations == 2
    assert cfg.rss() == (tmp_path / "rss").resolve()


def test_missing_runner(tmp_path, monkeypatch):
    monkeypatch.delenv("ROBOSIMSTUDIO_REPO", raising=False)
    cfg = load_config(ROOT / "examples" / "cube_in_tray" / "config.yaml")
    with pytest.raises(ValueError):
        cfg.rss()


def test_command(tmp_path):
    cfg = load_config(ROOT / "examples" / "cube_in_tray" / "config.yaml", [f"rss_repo={_rss(tmp_path)}"])
    cmd = build_command(cfg, tmp_path / "wf", "0:6", tmp_path / "out", "train")
    joined = " ".join(cmd)
    assert "--capture-state" in cmd and "--no-suite-tools" in cmd and "--record" not in cmd
    assert "--task cube_in_tray/base" in joined and "--episodes 0:6" in joined and "--solve graph" in joined
    assert "--record" in build_command(cfg, tmp_path / "wf", "20:26", tmp_path / "out", "eval", record=True)


def test_episode_ids():
    assert episode_ids("0:6") == (0, 1, 2, 3, 4, 5)
    assert episode_ids("20:26:2") == (20, 22, 24)
    assert episode_ids("5,1,1") == (1, 5)
    assert episode_ids("7") == (7,)


def test_read_batch(tmp_path):
    rows = [{"episode_id": 2, "success": True}, {"episode_id": 1, "success": False}]
    (tmp_path / "episode_results.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    batch = read_batch(tmp_path)
    batch.requested = 3
    assert [r["episode_id"] for r in batch.rows] == [1, 2]
    assert (batch.successes, batch.n) == (1, 3)


def test_a_condition_config_overlays_its_base(tmp_path):
    configs = ROOT / "examples" / "cube_in_tray" / "configs"
    motion = load_config(configs / "motion.yaml", [f"rss_repo={_rss(tmp_path)}"])
    assert motion.feedback.granularity == "motion" and motion.feedback.form == ["state", "relations"]
    assert motion.task_root == ROOT / "examples" / "cube_in_tray" / "tasks"  # the base's path, read from its directory
    assert motion.name == "cube_in_tray_motion"
    codex = load_config(configs / "codex.yaml")
    assert (codex.agent.kind, codex.agent.model) == ("codex", "gpt-6-astra")
    skills = load_config(configs / "skills_full.yaml")
    assert skills.skills.mode == "full" and skills.skills.path == ROOT.parent / "open-robot-skills"


def test_feedback_defaults_to_the_reference_and_forms_are_ordered(tmp_path):
    (tmp_path / "c.yaml").write_text(
        "name: x\ntask: a/b\ntask_root: .\ninstruction: i\ntools: t.json\nfeedback: {form: [relations, state, state]}\n"
    )
    cfg = load_config(tmp_path / "c.yaml")
    assert cfg.feedback.form == ["state", "relations"] and cfg.feedback.spatial == "parts"
    assert cfg.feedback.granularity == "semantic" and cfg.out_root == tmp_path / "outputs"
    assert cfg.agent.model == "claude-opus-5-5"


def test_held_out_batches_capture_nothing_and_visual_records_its_cameras(tmp_path):
    cfg = load_config(ROOT / "examples" / "cube_in_tray" / "config.yaml", [f"rss_repo={_rss(tmp_path)}"])
    held_out = build_command(cfg, tmp_path / "wf", "20:26", tmp_path / "out", "eval", capture=False)
    assert "--capture-state" not in held_out and "--record" not in held_out
    visual = build_command(cfg, tmp_path / "wf", "0:6", tmp_path / "out", "train", record=True, cameras=["top", "wrist"])
    assert "--capture-state" in visual and "--record" in visual
    assert visual[visual.index("--record-cameras") + 1] == "top,wrist"


def test_episode_specs_stay_specs(tmp_path):
    cfg = load_config(
        ROOT / "examples" / "cube_in_tray" / "config.yaml", ["eval_episodes=20:26", "train_episodes=3"]
    )
    assert (cfg.eval_episodes, cfg.train_episodes) == ("20:26", "3")
    assert episode_ids(cfg.eval_episodes) == (20, 21, 22, 23, 24, 25)
    (tmp_path / "c.yaml").write_text(
        "name: x\ntask: a/b\ntask_root: .\ninstruction: i\ntools: t.json\n"
        "train_episodes: 1:5\neval_episodes: 10:16\nloop: {max_usd: 6}\n"
    )
    cfg = load_config(tmp_path / "c.yaml")
    assert (cfg.train_episodes, cfg.eval_episodes, cfg.loop.max_usd) == ("1:5", "10:16", 6.0)


FAKE_RUNNER = """
import argparse, json, pathlib
parser = argparse.ArgumentParser()
parser.add_argument("--out")
parser.add_argument("--name")
parser.add_argument("--episodes")
parser.add_argument("--graph")
args, _ = parser.parse_known_args()
first, last = (int(v) for v in args.episodes.split(":"))
root = pathlib.Path(args.out) / args.name
root.mkdir(parents=True, exist_ok=True)
with (root / "episode_results.jsonl").open("a") as handle:  # appends, as RoboSimStudio's store does
    for i in range(first, last):
        handle.write(json.dumps({"episode_id": i, "success": "good" in pathlib.Path(args.graph).name}) + "\\n")
"""


def test_a_batch_replaces_an_earlier_one_of_the_same_name(tmp_path):
    rss = _rss(tmp_path)
    (rss / "scripts" / "bench_run.py").write_text(FAKE_RUNNER)
    cfg = load_config(ROOT / "examples" / "cube_in_tray" / "config.yaml", [f"rss_repo={rss}"])
    first = run_batch(cfg, tmp_path / "good", "20:26", tmp_path / "rollout", "rollout")
    second = run_batch(cfg, tmp_path / "bad", "20:26", tmp_path / "rollout", "rollout")
    assert (first.successes, first.n) == (6, 6)
    assert (second.successes, second.n, len(second.rows)) == (0, 6, 6)
