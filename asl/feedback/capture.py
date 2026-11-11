# SPDX-License-Identifier: Apache-2.0
"""Read an episode's raw capture: the files RoboSimStudio writes with ``--capture-state``.

An episode directory holds ``capture.npz`` (every recorded control step: body
and joint state), ``capture_manifest.json`` (which index is which body, arm and
shape, plus each asset's declared parts), ``spans.jsonl`` (one row per tool
call that stepped the simulation, with its first and last step and the graph
node it ran in), ``events.jsonl`` and ``contacts.jsonl``.

This is a reader of RoboSimStudio's ``robosimstudio.capture.v1`` format with the
same API as ``robosimstudio.record.EpisodeCapture``, kept here so the feedback
code reads a capture without importing the simulator. A point is the arrays at
one step; a span is two point references and a lazy slice of the same tape.
Nothing in this module interprets what the arrays mean.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

__all__ = ["EpisodeCapture", "RawPoint", "RawSpan", "episode_dir", "open_episode_capture"]


@dataclass(frozen=True)
class RawPoint:
    """One recorded instant; array values are views into the episode tape."""

    index: int
    step: int
    sim_time: float
    wall_time: float
    arrays: dict[str, np.ndarray]
    manifest: dict[str, Any]
    contacts: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class RawSpan:
    """One tool call's interval over the episode tape."""

    source: EpisodeCapture
    metadata: dict[str, Any]

    @property
    def before(self) -> RawPoint:
        return self.source.point(step=int(self.metadata["start_step"]))

    @property
    def after(self) -> RawPoint:
        return self.source.point(step=int(self.metadata["end_step"]))

    def points(self) -> Iterator[RawPoint]:
        start, end = int(self.metadata["start_step"]), int(self.metadata["end_step"])
        yield from self.source.points(start_step=start, end_step=end)

    @property
    def id(self) -> int:
        return int(self.metadata["span_id"])


class EpisodeCapture:
    """Point and span views over one episode's ``capture.npz`` and marker files."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.manifest = json.loads((self.path / "capture_manifest.json").read_text())
        with np.load(self.path / "capture.npz", allow_pickle=False) as data:
            self.arrays = {key: data[key] for key in data.files}
        self._step_to_index = {int(step): i for i, step in enumerate(self.arrays["step"])}
        self.spans = self._jsonl(self.path / "spans.jsonl")
        self.events = self._jsonl(self.path / "events.jsonl")
        contacts = self._jsonl(self.path / "contacts.jsonl")
        self._contacts = {int(row["step"]): list(row.get("pairs") or []) for row in contacts}

    @staticmethod
    def _jsonl(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def point(self, *, step: int | None = None, index: int | None = None, event: str | None = None) -> RawPoint:
        """The point at a recorded *step*, tape *index* or last *event*; ``KeyError`` for an unrecorded step."""
        if event is not None:
            matches = [row for row in self.events if row.get("event") == event]
            if not matches:
                raise KeyError(f"no capture event {event!r}")
            step = int(matches[-1]["step"])
        if index is None:
            if step is None:
                raise ValueError("one of step, index or event is required")
            try:
                index = self._step_to_index[int(step)]
            except KeyError as exc:
                raise KeyError(f"step {step} was not recorded") from exc
        index = int(index)
        values = {
            key: value[index]
            for key, value in self.arrays.items()
            if key not in {"step", "sim_time", "wall_time"} and len(value) == len(self.arrays["step"])
        }
        actual_step = int(self.arrays["step"][index])
        return RawPoint(
            index=index,
            step=actual_step,
            sim_time=float(self.arrays["sim_time"][index]),
            wall_time=float(self.arrays["wall_time"][index]) if "wall_time" in self.arrays else 0.0,
            arrays=values,
            manifest=self.manifest,
            contacts=self._contacts.get(actual_step, []),
        )

    def points(self, *, start_step: int = 0, end_step: int | None = None) -> Iterator[RawPoint]:
        for index, step in enumerate(self.arrays["step"]):
            value = int(step)
            if value < start_step or (end_step is not None and value > end_step):
                continue
            yield self.point(index=index)

    def iter_spans(self) -> Iterator[RawSpan]:
        for row in self.spans:
            yield RawSpan(self, row)


def episode_dir(batch_dir: Path, episode_id: int, row: dict[str, Any] | None = None) -> Path | None:
    """An episode's artifact directory in a runner batch, serial or sharded over workers."""
    batch_dir = Path(batch_dir)
    name = f"{int(episode_id):04d}"
    candidates = [batch_dir / name]
    worker = (row or {}).get("worker")
    if worker is not None:
        candidates.append(batch_dir / "shards" / f"{int(worker):02d}" / name)
    candidates.extend(sorted((batch_dir / "shards").glob(f"*/{name}")))
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def open_episode_capture(batch_dir: Path, episode_id: int, row: dict[str, Any] | None = None) -> EpisodeCapture | None:
    """The episode's capture, or ``None`` when the batch ran without ``--capture-state``."""
    path = episode_dir(batch_dir, episode_id, row)
    if path is not None and (path / "capture_manifest.json").is_file() and (path / "capture.npz").is_file():
        return EpisodeCapture(path)
    return None
