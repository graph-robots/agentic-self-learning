# SPDX-License-Identifier: Apache-2.0
"""Simulation feedback: build a packet from a training batch, render it for one condition.

    packet = build_packet(batch_dir, rows, iteration=k, task=..., instruction=...)
    text = render(packet, cfg.feedback)          # FEEDBACK.md

:mod:`.capture` reads RoboSimStudio's raw capture, :mod:`.facts` and
:mod:`.goals` derive facts and graded goals from it, :mod:`.extract` builds the
packet, :mod:`.design` renders it, :mod:`.frames` takes stills for the visual form.
"""

from __future__ import annotations

from typing import Any

from .design import Condition, design_markdown, view
from .extract import behavior_digest, build_packet
from .frames import stage_frames
from .schema import FeedbackPacket, IterationSummary

__all__ = [
    "Condition",
    "FeedbackPacket",
    "IterationSummary",
    "behavior_digest",
    "build_packet",
    "render",
    "stage_frames",
    "view",
]


def render(packet: FeedbackPacket, feedback: Any) -> str:
    """FEEDBACK.md: *packet* as the condition *feedback* shows it."""
    return design_markdown(view(packet, feedback), max_episodes=int(getattr(feedback, "max_episodes", 6)))
