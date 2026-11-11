# SPDX-License-Identifier: Apache-2.0
"""Stills for the ``visual`` feedback form: frames of the recorded video at unit boundaries.

A visual condition's training batches are recorded (``--record``), and for
the episodes the feedback renders in full, stills are taken where each
feedback unit begins and ends, spent around the first failure. The loop
copies them into the agent's workspace as ``frames/`` and the feedback cites
them by name.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import numpy as np

from .capture import episode_dir
from .design import Condition, Unit, representatives, units_of
from .schema import EpisodeFeedback, FeedbackPacket, UnitFrame

__all__ = ["choose_cameras", "extract_unit_frames", "stage_frames", "video_frames_at"]


WRIST_WORDS = ("wrist", "eye_in_hand", "hand")
SCENE_WORDS = ("overhead", "agentview", "front", "scene", "top", "photo", "topdown", "side", "mating")


def choose_cameras(available: list[str], wanted: tuple[str, ...] = ()) -> list[str]:
    """A scene camera and a wrist camera, by name; the config's own list wins."""
    if wanted:
        return [c for c in wanted if c in available]
    wrist = next((c for c in sorted(available) if any(w in c.lower() for w in WRIST_WORDS)), None)
    scene = next(
        (c for word in SCENE_WORDS for c in sorted(available) if word in c.lower() and c != wrist),
        next((c for c in sorted(available) if c != wrist), None),
    )
    if wrist is None:
        # A rig with no hand camera still gets two views: a second static
        # one, so the visual form always shows two angles.
        second = next((c for c in sorted(available) if c != scene), None)
        return [c for c in (scene, second) if c]
    return [c for c in (scene, wrist) if c]


def _frame_name(ep: EpisodeFeedback, unit: Unit, when: str, camera: str) -> str:
    key = unit.key.replace(":", "-").replace(".", "_").replace("/", "_")
    return f"e{ep.episode_id}_{key}_{when}_{camera}.png"


def extract_unit_frames(packet: FeedbackPacket, run_dir: Path, design: Any, *, budget_episodes: int = 6) -> None:
    """Stills at the condition's unit boundaries for the representative episodes, in place.

    Spent around the first failure: the failing unit's before/after first,
    then its neighbours outward, then each other representative's failing
    unit, then a success's start and end -- until ``max_frames`` stills.
    """
    cond = Condition.of(design)
    reps, _groups = representatives(packet, budget=budget_episodes, compress=True)
    plan: list[tuple[tuple, EpisodeFeedback, Unit, str]] = []
    for rank, ep in enumerate(reps):
        units = [u for u in units_of(ep, cond.granularity) if u.start_step is not None and u.end_step is not None]
        if not units:
            continue
        focus = next((i for i, u in enumerate(units) if u.failed), len(units) - 1)
        for i, unit in enumerate(units):
            distance = abs(i - focus)
            for order, when in enumerate(("after", "before")):
                plan.append(((0 if not ep.success else 1, rank, distance, order), ep, unit, when))
    plan.sort(key=lambda item: item[0])
    by_episode: dict[int, list[tuple[Unit, str]]] = {}
    cameras_of: dict[int, list[str]] = {}
    budget = max(0, int(cond.max_frames))
    for _key, ep, unit, when in plan:
        artifact = episode_dir(run_dir, ep.episode_id)
        if artifact is None or not (artifact / "cameras").is_dir():
            continue
        if ep.episode_id not in cameras_of:
            available = sorted(p.stem for p in (artifact / "cameras").glob("*.mp4"))
            cameras_of[ep.episode_id] = choose_cameras(available, cond.cameras)
        cams = cameras_of[ep.episode_id]
        if not cams or budget < len(cams):
            continue
        by_episode.setdefault(ep.episode_id, []).append((unit, when))
        budget -= len(cams)
    for ep in packet.episodes:
        wanted = by_episode.get(ep.episode_id)
        if not wanted:
            continue
        artifact = episode_dir(run_dir, ep.episode_id)
        if artifact is None:
            continue
        steps = sorted({(u.start_step if when == "before" else u.end_step) for u, when in wanted})
        for camera in cameras_of.get(ep.episode_id, []):
            stills = video_frames_at(artifact, camera, steps)
            for unit, when in wanted:
                step = unit.start_step if when == "before" else unit.end_step
                path = stills.get(step)
                if path is None:
                    continue
                ep.unit_frames.append(UnitFrame(
                    unit=unit.key, when=when, camera=camera, step=int(step), path=str(path),
                    name=_frame_name(ep, unit, when, camera),
                ))
        ep.unit_frames.sort(key=lambda f: (f.step, f.when != "before", f.camera))


def stage_frames(packet: FeedbackPacket, dest: Path) -> list[Path]:
    """Copy the stills a condition's view cites into *dest* under the names it cites them by."""
    written: list[Path] = []
    if packet.design is None:
        return written
    for ep in packet.episodes:
        for frame in ep.unit_frames:
            source = Path(frame.path)
            if not source.is_file():
                continue
            dest.mkdir(parents=True, exist_ok=True)
            target = dest / frame.name
            if not target.exists():
                shutil.copyfile(source, target)
            written.append(target)
    return written


def video_frames_at(artifact_dir: Path, camera: str, steps: list[int]) -> dict[int, Path]:
    """Stills of one camera's recording at given control steps, as PNGs beside it.

    The recorder samples video on the SIMULATION clock at its own frame rate,
    starting from the first commanded motion (``robosimstudio.record``), so a
    control step is mapped to a frame by its sim time: the capture tape gives
    each step's sim time, the recorded steps (``steps.npz``) the video's first
    and last sim time. Without those, the step's fraction of the episode is the
    fallback. Stills cache per ``<camera>_<frame>.png`` in ``cameras/frames/``.
    Any failure returns what was written so far.
    """
    video = Path(artifact_dir) / "cameras" / f"{camera}.mp4"
    out: dict[int, Path] = {}
    if not video.is_file() or not steps:
        return out
    try:
        import imageio.v2 as iio

        reader = iio.get_reader(str(video), format="FFMPEG")
        try:
            total = int(reader.count_frames())
        except Exception:  # noqa: BLE001 -- some containers cannot be counted
            total = 0
        if total <= 0:
            reader.close()
            return out
        cap_steps = cap_time = rec_time = None
        try:
            with np.load(Path(artifact_dir) / "capture.npz") as tape:
                cap_steps = np.asarray(tape["step"], dtype=np.float64)
                cap_time = np.asarray(tape["sim_time"], dtype=np.float64)
        except Exception:  # noqa: BLE001 -- the fraction fallback below
            pass
        try:
            with np.load(Path(artifact_dir) / "steps.npz") as recorded:
                rec_time = np.asarray(recorded["sim_time"], dtype=np.float64)
        except Exception:  # noqa: BLE001
            pass
        frames_dir = video.parent / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        for step in sorted(set(int(s) for s in steps)):
            if cap_steps is not None and rec_time is not None and len(rec_time) > 1 and rec_time[-1] > rec_time[0]:
                t = float(np.interp(step, cap_steps, cap_time))
                fps = (total - 1) / float(rec_time[-1] - rec_time[0])
                index = int(round((t - float(rec_time[0])) * fps))
            elif cap_steps is not None and len(cap_steps) and cap_steps[-1] > 0:
                index = int(round(step / float(cap_steps[-1]) * (total - 1)))
            else:
                index = 0
            index = min(total - 1, max(0, index))
            path = frames_dir / f"{camera}_{index:06d}.png"
            if not path.exists():
                iio.imwrite(path, reader.get_data(index))
            out[step] = path
        reader.close()
    except Exception as exc:  # noqa: BLE001 -- a missing decoder is not a run failure
        print(f"[feedback] could not take stills from {video}: {type(exc).__name__}: {exc}")
    return out
