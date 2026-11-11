# SPDX-License-Identifier: Apache-2.0
"""Cut the feedback test fixture from a real training batch, and write its goldens.

    uv run python tests/make_fixture.py <run>/iterations/k000/train [<run>/iterations/k002/train ...]

Keeps one failed and one successful episode, taken from the first batches that
have them (with different episode ids), and from each
only what the feedback reads: the capture's state arrays, the contact pairs
the fact extractor keeps, the spans and events, and the trace's node table,
outputs and recorded calls. Absolute paths are cut from the rows and traces.
The packet built from the fixture must render exactly as the one built from
the original batch; this script checks that before it writes the goldens.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

from asl.config import FeedbackConfig
from asl.feedback import build_packet, render

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "cube_in_tray"
TASK = "cube_in_tray/base"
INSTRUCTION = "pick up the red cube and put it in the tray"

CONDITIONS = {
    "reference": {},
    "success_only": {"form": []},
    "state": {"form": ["state"]},
    "relations": {"form": ["relations"]},
    "positions": {"spatial": "positions"},
    "frames": {"spatial": "frames"},
    "episode": {"granularity": "episode"},
    "motion": {"granularity": "motion"},
}
"""Every condition but ``visual``, whose stills need the recorded video."""

ARRAYS = ("step", "sim_time", "wall_time", "body_q", "body_qd", "joint_q")
PATH = re.compile(r"/(?:home|tmp|Users)/[^\s\"']*")


def _rows(batch: Path) -> list[dict]:
    return [json.loads(line) for line in (batch / "episode_results.jsonl").read_text().splitlines() if line.strip()]


def _scrub(text: str) -> str:
    return PATH.sub("<path>", text)


def _kept_contacts(src: Path, dest: Path, manifest: dict) -> None:
    """The contact pairs the feedback can use: those touching a movable object or a finger, above the
    extractor's impulse threshold, one row per shape pair per step, floats to six digits."""
    relevant: set[int] = set()
    for entity in (manifest.get("entities") or {}).values():
        if not entity.get("static", False):
            relevant |= {int(s) for s in entity.get("shapes") or ()}
    for arm in (manifest.get("arms") or {}).values():
        relevant |= {int(s) for side in arm.get("finger_shapes") or () for s in side}

    def g(v: float) -> float:
        return float(f"{float(v):.6g}")

    out = []
    for line in src.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        seen: set[tuple[int, int]] = set()
        pairs = []
        for p in row.get("pairs") or []:
            impulse = np.asarray(p.get("impulse") or [0.0, 0.0, 0.0], dtype=np.float64)
            if float(np.linalg.norm(impulse)) < 1e-6 and float(p.get("distance", 0.0)) > 0.0:
                continue
            key = (int(p.get("shape_a", -1)), int(p.get("shape_b", -1)))
            if key in seen or not (set(key) & relevant):
                continue
            seen.add(key)
            pairs.append({"shape_a": key[0], "shape_b": key[1], "impulse": [g(v) for v in impulse],
                          "distance": g(p.get("distance", 0.0))})
        if pairs:
            out.append(json.dumps({"step": row["step"], "pairs": pairs}, separators=(",", ":")))
    dest.write_text("\n".join(out) + ("\n" if out else ""))


def cut(batch: Path, dest: Path) -> list[int]:
    rows = _rows(batch)
    failed = [r for r in rows if not r.get("success")]
    passed = [r for r in rows if r.get("success")]
    chosen = ([failed[0]] if failed else []) + ([passed[0]] if passed else [])
    if len(chosen) < 2:
        chosen = rows[:2]
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for row in chosen:
        name = f"{int(row['episode_id']):04d}"
        src, out = batch / name, dest / name
        out.mkdir()
        with np.load(src / "capture.npz", allow_pickle=False) as data:
            np.savez_compressed(out / "capture.npz", **{k: data[k] for k in ARRAYS if k in data.files})
        for f in ("capture_manifest.json", "spans.jsonl", "events.jsonl"):
            if (src / f).is_file():
                (out / f).write_text(_scrub((src / f).read_text()))
        if (src / "contacts.jsonl").is_file():
            manifest = json.loads((src / "capture_manifest.json").read_text())
            _kept_contacts(src / "contacts.jsonl", out / "contacts.jsonl", manifest)
        trace_src, trace_out = batch / "traces" / name, dest / "traces" / name
        trace_out.mkdir(parents=True)
        for f in ("dag_trace.json", "graph_result.json"):
            if (trace_src / f).is_file():
                (trace_out / f).write_text(_scrub((trace_src / f).read_text()))
        for f in sorted((trace_src / "node_data").glob("*/output.json")) + sorted(
            (trace_src / "node_data").glob("*/calls/*/request*.json")
        ):
            target = trace_out / f.relative_to(trace_src)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(_scrub(f.read_text()))
    (dest / "episode_results.jsonl").write_text("".join(_scrub(json.dumps(r)) + "\n" for r in chosen))
    return [int(r["episode_id"]) for r in chosen]


def renders(batch: Path, episodes: list[int]) -> dict[str, str]:
    rows = [r for r in _rows(batch) if int(r["episode_id"]) in episodes]
    packet = build_packet(batch, rows, iteration=0, task=TASK, instruction=INSTRUCTION, requested=len(rows))
    return {name: render(packet, FeedbackConfig(**spec)) for name, spec in CONDITIONS.items()}


def gather(batches: list[Path], into: Path) -> Path:
    """One batch directory holding the first failure and the first success (by distinct id) across *batches*."""
    failed = next(((b, r) for b in batches for r in _rows(b) if not r.get("success")), None)
    passed = next(
        ((b, r) for b in batches for r in _rows(b)
         if r.get("success") and (failed is None or r["episode_id"] != failed[1]["episode_id"])),
        None,
    )
    picks = [p for p in (failed, passed) if p is not None]
    (into / "traces").mkdir(parents=True)
    for batch, row in picks:
        name = f"{int(row['episode_id']):04d}"
        (into / name).symlink_to(batch / name, target_is_directory=True)
        (into / "traces" / name).symlink_to(batch / "traces" / name, target_is_directory=True)
    (into / "episode_results.jsonl").write_text("".join(json.dumps(r) + "\n" for _b, r in picks))
    return into


def main(argv: list[str]) -> int:
    scratch = Path(tempfile.mkdtemp())
    batch = gather([Path(a).resolve() for a in argv[1:]], scratch / "batch")
    data = FIXTURE / "train"
    episodes = cut(batch, data)
    original, trimmed = renders(batch, episodes), renders(data, episodes)
    for name in CONDITIONS:
        if original[name] != trimmed[name]:
            raise SystemExit(f"the trimmed fixture renders {name} differently from the original batch")
    expected = FIXTURE / "expected"
    expected.mkdir(parents=True, exist_ok=True)
    for name, text in trimmed.items():
        (expected / f"{name}.md").write_text(text)
    size = sum(p.stat().st_size for p in FIXTURE.rglob("*") if p.is_file())
    print(f"episodes {episodes}; fixture {size / 1e6:.2f} MB; {len(trimmed)} goldens")
    shutil.rmtree(scratch)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
