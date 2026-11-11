# SPDX-License-Identifier: Apache-2.0
"""Run a graph on a set of episodes with RoboSimStudio's runner, and read the results.

Training batches run with ``--capture-state``: every condition's feedback is
built from the same raw capture, so what is recorded does not depend on what
the agent will be shown. The one exception is video: a batch is recorded
(``--record``) only for ``asl-rollout`` and for a run under the visual
feedback form, so only such a run has stills to show. Held-out batches record
nothing beyond their scores.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .config import Config

__all__ = ["Batch", "build_command", "episode_ids", "read_batch", "run_batch"]


def episode_ids(spec: str) -> tuple[int, ...]:
    """The ids an episode spec names: ``a:b`` (half-open), ``a:b:s``, ``a,b,c`` or ``a``."""
    text = str(spec).strip()
    if "," in text:
        return tuple(sorted({int(v) for v in text.split(",") if v.strip()}))
    if text.count(":") == 2:
        first, last, stride = (int(v) for v in text.split(":"))
        return tuple(range(first, last, max(1, stride)))
    first, _, last = text.partition(":")
    return tuple(range(int(first), int(last) if last else int(first) + 1))


@dataclass
class Batch:
    """One runner invocation: where it wrote, and one result row per episode."""

    run_dir: Path
    rows: list[dict] = field(default_factory=list)
    requested: int = 0
    """Episodes asked for. A runner that dies mid-batch writes fewer rows; the missing ones count as failures."""

    @property
    def n(self) -> int:
        return max(len(self.rows), self.requested)

    @property
    def successes(self) -> int:
        return sum(1 for row in self.rows if row.get("success"))

    @property
    def success_rate(self) -> float:
        return self.successes / self.n if self.n else 0.0


def build_command(
    cfg: Config,
    graph_dir: Path,
    episodes: str,
    out_dir: Path,
    name: str,
    *,
    record: bool = False,
    capture: bool = True,
    cameras: list[str] | None = None,
) -> list[str]:
    """The ``scripts/bench_run.py`` argv for one batch. Every path is absolute: the runner's cwd is RSS."""
    ex = cfg.execution
    cmd = [
        sys.executable,
        str(cfg.rss() / "scripts" / "bench_run.py"),
        "--task-root",
        str(Path(cfg.task_root).resolve()),
        "--task",
        cfg.task,
        "--solve",
        "graph",
        "--graph",
        str(Path(graph_dir).resolve()),
        "--allow-undeclared-graph",
        "--no-suite-tools",
        "--episodes",
        episodes,
        "--perception",
        ex.perception,
        "--motion",
        ex.motion,
        "--settle-steps",
        str(int(ex.settle_steps)),
        "--bus-timeout",
        str(float(ex.bus_timeout)),
        "--device",
        ex.device,
        "--out",
        str(Path(out_dir).resolve()),
        "--name",
        name,
    ]
    if capture:
        cmd.append("--capture-state")
    if ex.max_steps:
        cmd += ["--max-steps", str(int(ex.max_steps))]
    if record:
        cmd += ["--record", "--record-fps", "30", "--renderer", ex.renderer]
        if cameras:
            cmd += ["--record-cameras", ",".join(cameras)]
    return cmd


def read_batch(run_dir: Path) -> Batch:
    path = Path(run_dir) / "episode_results.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.is_file() else []
    rows.sort(key=lambda row: int(row.get("episode_id", 0)))
    return Batch(run_dir=Path(run_dir), rows=rows)


def run_batch(
    cfg: Config,
    graph_dir: Path,
    episodes: str,
    out_dir: Path,
    name: str,
    *,
    record: bool = False,
    capture: bool = True,
    cameras: list[str] | None = None,
) -> Batch:
    """Run *graph_dir* on *episodes*; the runner's output goes to ``<out_dir>/<name>.log``.

    An earlier batch in ``<out_dir>/<name>/`` is removed first: the runner
    appends to its results, and its rows would be counted with these.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(out_dir / name, ignore_errors=True)
    env = dict(os.environ)
    rss = str(cfg.rss())
    env["PYTHONPATH"] = os.pathsep.join(p for p in (rss, env.get("PYTHONPATH", "")) if p)
    env.setdefault("HF_HUB_OFFLINE", "1")
    if cfg.execution.gpu is not None:
        env["CUDA_VISIBLE_DEVICES"] = str(cfg.execution.gpu)
    cmd = build_command(cfg, graph_dir, episodes, out_dir, name, record=record, capture=capture, cameras=cameras)
    log = out_dir / f"{name}.log"
    with log.open("w") as handle:
        try:
            subprocess.run(
                cmd,
                cwd=rss,
                env=env,
                stdout=handle,
                stderr=subprocess.STDOUT,
                timeout=cfg.execution.timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired:
            handle.write(f"\n[asl] batch exceeded {cfg.execution.timeout_s:.0f} s and was stopped\n")
    batch = read_batch(out_dir / name)
    batch.requested = len(episode_ids(episodes))
    if not batch.rows:
        raise RuntimeError(f"the runner wrote no results for {name}; see {log}")
    return batch
