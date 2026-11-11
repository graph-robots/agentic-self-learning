# SPDX-License-Identifier: Apache-2.0
"""asl-feedback: render a saved training batch under any feedback condition.

    asl-feedback outputs/<name>/<stamp>/iterations/k000 --spatial frames --granularity motion

The source is an iteration directory (its ``feedback.json``), a ``feedback.json``
itself, or a runner batch directory (``episode_results.jsonl`` and the
captures), which is built into a packet first. The condition defaults to the
reference: ``--form state relations --spatial parts --granularity semantic``.

``--form visual`` needs stills, and only a batch recorded on video has them: a
run under the visual form (at that run's granularity), or a batch directory
with its recorded video.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..config import FeedbackConfig
from . import render
from .design import units_of
from .extract import build_packet
from .schema import FeedbackPacket


def _packet(source: Path, task: str, instruction: str, feedback: FeedbackConfig) -> FeedbackPacket:
    if source.is_dir() and (source / "feedback.json").is_file():
        source = source / "feedback.json"
    if source.is_file():
        return FeedbackPacket.model_validate_json(source.read_text())
    results = source / "episode_results.jsonl"
    if not results.is_file():
        raise SystemExit(f"{source}: no feedback.json and no episode_results.jsonl")
    rows = [json.loads(line) for line in results.read_text().splitlines() if line.strip()]
    return build_packet(source, rows, iteration=0, task=task, instruction=instruction, feedback=feedback)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="asl-feedback", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--form", nargs="*", default=["state", "relations"], choices=["visual", "state", "relations"])
    parser.add_argument("--spatial", default="parts", choices=["positions", "frames", "parts"])
    parser.add_argument("--granularity", default="semantic", choices=["episode", "motion", "semantic"])
    parser.add_argument("--max-episodes", type=int, default=6)
    parser.add_argument("--task", default="", help="suite/variant, when building from a batch directory")
    parser.add_argument("--instruction", default="", help="the instruction, when building from a batch directory")
    args = parser.parse_args(argv)
    feedback = FeedbackConfig(
        form=args.form, spatial=args.spatial, granularity=args.granularity, max_episodes=args.max_episodes
    )
    packet = _packet(args.source, args.task, args.instruction, feedback)
    if "visual" in feedback.form and not any(
        frame.unit in {u.key for u in units_of(ep, feedback.granularity)}
        for ep in packet.episodes
        for frame in ep.unit_frames
    ):
        print(
            "asl-feedback: no stills: this batch was not recorded on video (run it under form: [visual]), "
            "or its stills were taken at another granularity",
            file=sys.stderr,
        )
    print(render(packet, feedback))
    return 0


if __name__ == "__main__":
    sys.exit(main())
