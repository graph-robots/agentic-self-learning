# SPDX-License-Identifier: Apache-2.0
"""The cube_in_tray task's registered names: its physics, its cameras, and the
episode sampler.

Every position below is in ``bench_075``'s work-surface frame (bench top centre =
origin, world (0.6, 0, 0.75)). The YAM i2rt right arm's base is at
(-0.3475, -0.31).
"""

from __future__ import annotations

import math

import numpy as np
from robosimstudio.core.cameras import CameraSpec
from robosimstudio.specs import ArrangementSpec, backend
from robosimstudio_bench.taskbuild.arrangements import register_arrangement, register_camera_rig

from .records import CUBE_HALF
from .tray import OUTER_HALF_X, OUTER_HALF_Y

CUBE_IN_TRAY_PHYSICS = register_arrangement(
    "cube_in_tray_mujoco@v1",
    # Every domain on MuJoCo, on MuJoCo's own contact table, so one solver owns
    # every contact: fingers on cube, cube on tray, fingers on tray walls.
    ArrangementSpec(
        control_hz=60.0,
        substeps=16,
        backends=(("*", backend("mujoco", use_mujoco_contacts=True, nconmax=8192, njmax=16384)),),
    ),
)

AIM = (0.55, -0.08, 0.77)
"""World point both cameras look at: between where the cube and the tray stand."""

CUBE_IN_TRAY_RIG = register_camera_rig(
    "cube_in_tray_views@v1",
    (
        CameraSpec(
            name="overhead",
            width=640,
            height=480,
            fov_y=50.0,
            eye=(AIM[0], AIM[1], 1.55),
            look_at=(AIM[0], AIM[1], 0.75),
            up=(1.0, 0.0, 0.0),
            near=0.01,
            far=4.0,
            channels=("rgb",),
        ),
        CameraSpec(
            name="oblique",
            width=640,
            height=480,
            fov_y=45.0,
            eye=(1.05, -0.40, 1.30),
            look_at=AIM,
            near=0.01,
            far=4.0,
            channels=("rgb",),
        ),
    ),
)

# ------------------------------------------------------------------ the draw

CUBE_X = (-0.08, 0.03)
CUBE_Y = (-0.23, -0.12)
"""Where the cube may start [m]: the right arm's side of the bench, in reach of a top-down grasp."""

CUBE_YAW = (-0.25 * math.pi, 0.25 * math.pi)
"""The cube's turn about z [rad]. A cube repeats every quarter turn."""

TRAY_X = (-0.11, -0.03)
TRAY_Y = (-0.02, 0.05)
"""Where the tray may stand [m], on the centreline side of the cube."""

CLEARANCE = 0.03
"""Least gap between the tray's outside and the cube's farthest corner [m]. Closer draws are redrawn."""

CUBE_MU = (0.5, 1.0)
CUBE_MASS = (0.03, 0.15)
TRAY_MU = (0.4, 1.0)
"""Physics drawn per episode: cube friction, cube mass [kg], tray friction."""


def _gap(cube: tuple[float, float], tray: tuple[float, float]) -> float:
    """Distance from the cube's centre to the tray's outside rectangle [m]."""
    dx = max(abs(cube[0] - tray[0]) - OUTER_HALF_X, 0.0)
    dy = max(abs(cube[1] - tray[1]) - OUTER_HALF_Y, 0.0)
    return math.hypot(dx, dy)


def draw_base(task, episode_id: int, rng: np.random.Generator) -> dict:
    """One episode: where the cube and the tray stand, how the cube is turned, and
    how heavy and slippery the two are. Every number comes from ``rng``."""
    del task, episode_id
    reach = math.sqrt(2.0) * CUBE_HALF + CLEARANCE
    for _ in range(1000):
        cube = (float(rng.uniform(*CUBE_X)), float(rng.uniform(*CUBE_Y)))
        tray = (float(rng.uniform(*TRAY_X)), float(rng.uniform(*TRAY_Y)))
        if _gap(cube, tray) >= reach:
            break
    else:
        raise RuntimeError("draw_base: no separated cube and tray in 1000 draws")
    return {
        "object_poses": {"cube": (cube[0], cube[1], CUBE_HALF + 0.0005, float(rng.uniform(*CUBE_YAW)))},
        "static_poses": {"tray": (tray[0], tray[1], 0.0, 0.0)},
        "physics": {
            "cube": {
                "contact.mu": float(rng.uniform(*CUBE_MU)),
                "mass.mass": float(rng.uniform(*CUBE_MASS)),
            },
            "tray": {"contact.mu": float(rng.uniform(*TRAY_MU))},
        },
    }


# Moving a welded fixture changes the model, so an episode that draws a new
# tray position rebuilds rather than re-poses.
draw_base.model_key_fields = ("static_poses",)
