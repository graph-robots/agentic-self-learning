# SPDX-License-Identifier: Apache-2.0
"""What this task's document names: a red cube, and the tray it goes into.

Both are primitives. The cube is one box; the tray is five (``tray.py``).

Each record declares its parts as features, in its own frame. They are what
the ``parts`` feedback condition names: the cube's ``up`` axis (is it still
upright?) and one ``face`` per tray box (the floor and the four walls, each
face being the box's top).

Layout, in the work-surface frame of ``bench_075`` (bench top centre = origin =
world (0.6, 0, 0.75)). The YAM i2rt pair mounts at x = -0.3475, y = +-0.31, and
both objects stand on the right arm's side of the bench.
"""

from __future__ import annotations

from robosimstudio.assetlib.record import AssetRecord
from robosimstudio.assetlib.registry import register_asset
from robosimstudio.assetlib.semantics.features import FeatureSpec
from robosimstudio.assetlib.sim import SimRequirements, contacts_with
from robosimstudio.core.render.palette import ACCENT_PORT
from robosimstudio.specs import ObjectSpec, StaticSpec
from robosimstudio.specs.asset import ShapeSpec

from .tray import OUTER_HALF_X, OUTER_HALF_Y, RIM, tray_boxes

__all__ = ["CUBE_AT", "CUBE_HALF", "RED_CUBE", "TRAY", "TRAY_AT", "red_cube", "tray"]

CUBE_HALF = 0.020
"""Half the cube's edge [m]: a 40 mm cube. The YAM's jaws open to 94 mm."""

CUBE_MASS = 0.05
"""What the cube weighs [kg] when the episode draws nothing else."""

CUBE_FRICTION = 0.8
"""Sliding friction at the cube's faces when the episode draws nothing else."""

CUBE_KE = 6.0e4
CUBE_KD = 500.0
"""Contact stiffness and damping [N/m, N.s/m]: stiff enough that a position-servoed
jaw closing on the cube does not sink into it."""

CUBE_COLOR = (0.80, 0.10, 0.08)
"""Red, because the instruction says so."""

CUBE_AT = (-0.03, -0.17)
"""Where the cube starts when the episode draws nothing else [m, surface frame]."""

TRAY_AT = (-0.07, 0.01)
"""Where the tray stands when the episode draws nothing else [m, surface frame]."""


def red_cube() -> ObjectSpec:
    """The cube, at rest on the bench top, with half a millimetre of settling clearance."""
    return ObjectSpec(
        name="cube",
        category=RED_CUBE.name,
        shape=ShapeSpec(kind="box", half_extents=(CUBE_HALF, CUBE_HALF, CUBE_HALF)),
        pose=(CUBE_AT[0], CUBE_AT[1], CUBE_HALF + 0.0005),
        quat=(0.0, 0.0, 0.0, 1.0),
        mass=CUBE_MASS,
        friction=CUBE_FRICTION,
        ke=CUBE_KE,
        kd=CUBE_KD,
        color=CUBE_COLOR,
    )


RED_CUBE = register_asset(
    AssetRecord(
        name="red_cube",
        summary="A 40 mm red cube: the thing that is picked up.",
        tags=("cube", "block", "red"),
        features=(
            FeatureSpec(
                name="body",
                kind="grasp_box",
                payload={"half": [CUBE_HALF, CUBE_HALF, CUBE_HALF], "center_local": [0.0, 0.0, 0.0]},
                provenance="The primitive box itself, read off CUBE_HALF.",
            ),
            FeatureSpec(
                name="up",
                kind="axis",
                payload={"origin": [0.0, 0.0, 0.0], "direction": [0.0, 0.0, 1.0]},
                provenance="The cube's own +z: whether it was turned over on the way.",
            ),
        ),
        sim=SimRequirements(domain="rigid", contacts=contacts_with("surface", "fixtures", "robot")),
        provenance="Authored for this example. A procedural box.",
        build=red_cube,
    )
)


def tray() -> StaticSpec:
    """The tray, standing on the bench. A fixture: it does not move during an episode."""
    return StaticSpec(
        name="tray",
        xform=(TRAY_AT[0], TRAY_AT[1], 0.0, 0.0, 0.0, 0.0, 1.0),
        color=ACCENT_PORT,
        entity="cube_in_tray_tray",
    )


TRAY = register_asset(
    AssetRecord(
        name="tray",
        summary=(
            f"An open tray, {2000 * OUTER_HALF_X:.0f} x {2000 * OUTER_HALF_Y:.0f} mm outside and "
            f"{1000 * RIM:.0f} mm tall, standing on the bench."
        ),
        tags=("tray", "container", "receptacle"),
        features=tuple(
            FeatureSpec(
                name=label,
                kind="face",
                payload={"center": list(centre), "half": list(half), "quat": [0.0, 0.0, 0.0, 1.0]},
                provenance=f"The tray's {label} box (tray.py); the face is its top.",
            )
            for label, centre, half in tray_boxes()
        ),
        sim=SimRequirements(domain="static", contacts=contacts_with("objects", "robot")),
        provenance="Authored for this example: a floor and four walls, each a primitive box (tray.py).",
        build=tray,
    )
)
