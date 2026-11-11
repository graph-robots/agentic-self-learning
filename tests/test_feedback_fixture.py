# SPDX-License-Identifier: Apache-2.0
"""A real training batch of the example, rendered under every feedback condition.

The fixture (``tests/fixtures/cube_in_tray``) is cut from a run by
``tests/make_fixture.py``, which also writes the goldens. A change to the
feedback that alters what any condition shows fails here; if the change is
intended, regenerate the fixture and read the diff of ``expected/``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from asl.config import FeedbackConfig
from asl.feedback import build_packet, render
from asl.feedback.capture import EpisodeCapture

from .make_fixture import CONDITIONS, INSTRUCTION, TASK

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "cube_in_tray"
BATCH = FIXTURE / "train"


def _packet():
    rows = [json.loads(line) for line in (BATCH / "episode_results.jsonl").read_text().splitlines() if line.strip()]
    return build_packet(BATCH, rows, iteration=0, task=TASK, instruction=INSTRUCTION, requested=len(rows))


@pytest.mark.parametrize("name", sorted(CONDITIONS))
def test_every_condition_renders_as_recorded(name):
    expected = (FIXTURE / "expected" / f"{name}.md").read_text()
    assert render(_packet(), FeedbackConfig(**CONDITIONS[name])) == expected


def test_the_fixture_has_a_failure_a_success_and_the_example_parts():
    packet = _packet()
    assert sorted(ep.success for ep in packet.episodes) == [False, True]
    assert set(packet.declared_features["tray"]) == {"floor", "wall_nx", "wall_ny", "wall_px", "wall_py"}
    assert "up" in packet.declared_features["cube"]
    assert all(ep.motion_spans and ep.nodes for ep in packet.episodes)


def test_the_reader_matches_robosimstudios_own():
    record = pytest.importorskip("robosimstudio.record")
    episode = next(p for p in sorted(BATCH.iterdir()) if (p / "capture.npz").is_file())
    ours, theirs = EpisodeCapture(episode), record.EpisodeCapture(episode)
    assert ours.manifest == theirs.manifest
    steps = [int(s) for s in ours.arrays["step"][:: max(1, len(ours.arrays["step"]) // 7)]]
    for step in steps:
        a, b = ours.point(step=step), theirs.point(step=step)
        assert a.step == b.step and a.sim_time == b.sim_time and a.contacts == b.contacts
        assert set(a.arrays) == set(b.arrays)
        assert all((a.arrays[k] == b.arrays[k]).all() for k in a.arrays)
    assert [s.metadata for s in ours.iter_spans()] == [s.metadata for s in theirs.iter_spans()]
    with pytest.raises(KeyError):
        ours.point(step=-5)


def test_asl_feedback_says_when_the_visual_form_has_no_stills(capsys):
    from asl.feedback.__main__ import main

    main([str(BATCH), "--form", "visual", "--task", TASK])
    assert "no stills: this batch was not recorded on video" in capsys.readouterr().err
    main([str(BATCH), "--form", "relations", "--task", TASK])
    assert capsys.readouterr().err == ""
