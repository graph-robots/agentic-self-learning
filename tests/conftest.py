# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent


def _pose(xyz):
    return [*xyz, 0.0, 0.0, 0.0, 1.0]


@pytest.fixture
def batch_dir(tmp_path: Path) -> Path:
    """A one-episode runner output: the hand moves to the cube, the cube is lifted 10 cm, a node raises."""
    run = tmp_path / "train"
    ep = run / "0000"
    ep.mkdir(parents=True)
    steps = np.arange(0, 101)
    body_q = np.zeros((101, 3, 7))
    for i in steps:
        hand = np.array([0.6, -0.4, 1.1]) + (np.array([0.5, 0.0, 0.8]) - np.array([0.6, -0.4, 1.1])) * min(i, 50) / 50
        cube = np.array([0.5, 0.0, 0.77]) + np.array([0.0, 0.0, 0.1]) * max(0, i - 60) / 40
        if i > 60:
            hand = cube + np.array([0.0, 0.0, 0.03])
        body_q[i, 0] = _pose(hand)
        body_q[i, 1] = _pose(cube)
        body_q[i, 2] = _pose([0.6, 0.0, 0.375])
    np.savez(ep / "capture.npz", step=steps, sim_time=steps / 60.0, wall_time=steps / 60.0, body_q=body_q)
    manifest = {
        "entities": {
            "cube": {"kind": "object", "body": 1, "static": False, "asset_type": "red_cube"},
            "tray": {
                "kind": "static",
                "body": -1,
                "static": True,
                "asset_type": "tray",
                "xform_xyzw": _pose([0.5, 0.2, 0.75]),
            },
        },
        "arms": {"right": {"arm_id": 0, "role": "work", "ee_body": 0, "ee_offset": [0.0, 0.0, 0.0]}},
    }
    (ep / "capture_manifest.json").write_text(json.dumps(manifest))
    spans = [
        {
            "span_id": 0,
            "tool": "robot.go_to_pose",
            "arm_id": 0,
            "start_step": 0,
            "end_step": 50,
            "status": "ok",
            "request": {
                "pose": {"position": {"x": 0.5, "y": 0.0, "z": 0.8}, "rotation": {"w": 0, "x": 1, "y": 0, "z": 0}}
            },
        },
        {
            "span_id": 1,
            "tool": "sim.get_object_pose",
            "arm_id": 0,
            "start_step": 50,
            "end_step": 50,
            "status": "ok",
            "request": {},
        },
        {
            "span_id": 2,
            "tool": "robot.close_gripper",
            "arm_id": 0,
            "start_step": 50,
            "end_step": 60,
            "status": "ok",
            "request": {},
        },
        {
            "span_id": 3,
            "tool": "robot.execute_trajectory",
            "arm_id": 0,
            "start_step": 60,
            "end_step": 100,
            "status": "error",
            "error": "servo: pose unreachable",
            "request": {"trajectory": {"waypoints": []}},
        },
    ]
    (ep / "spans.jsonl").write_text("\n".join(json.dumps(s) for s in spans) + "\n")
    trace = run / "traces" / "0000"
    trace.mkdir(parents=True)
    (trace / "dag_trace.json").write_text(
        json.dumps(
            {
                "nodes": [
                    {
                        "name": "grasp_sg.lift",
                        "status": "error",
                        "started_at": "5.0",
                        "error_message": "Node 'grasp_sg.lift' failed: RuntimeError: servo: pose unreachable",
                    },
                    {"name": "grasp_sg.close", "status": "ok", "started_at": "4.0"},
                ]
            }
        )
    )
    row = {"episode_id": 0, "success": False, "episode_length": 100, "close_kind": "truncated"}
    (run / "episode_results.jsonl").write_text(json.dumps(row) + "\n")
    return run
