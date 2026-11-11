# SPDX-License-Identifier: Apache-2.0
"""The tray: an open box built from five primitive boxes, a floor and four walls.

No mesh. Every piece is a box that is drawn and collided as itself, in the
tray's own frame: origin at the centre of its foot on the bench, +x along its
long side, +z up.
"""

from __future__ import annotations

import newton
import warp as wp
from robosimstudio.core.math import transform_point
from robosimstudio.domains.static.entity import EntityStatic
from robosimstudio.scene.registry import register_entity

INNER_HALF_X = 0.080
"""Half the inside length [m]: 160 mm between the end walls."""

INNER_HALF_Y = 0.060
"""Half the inside width [m]: 120 mm between the side walls."""

WALL = 0.010
"""Wall thickness [m]."""

FLOOR_TOP = 0.008
"""Height of the floor's top face above the bench [m]."""

RIM = 0.045
"""Height of the walls' top edge above the bench [m]."""

OUTER_HALF_X = INNER_HALF_X + WALL
OUTER_HALF_Y = INNER_HALF_Y + WALL


def tray_boxes() -> tuple[tuple[str, tuple[float, float, float], tuple[float, float, float]], ...]:
    """Every box the tray is made of: ``(label, centre, half_extents)`` in its own frame."""
    wall_half_z = 0.5 * RIM
    return (
        ("floor", (0.0, 0.0, 0.5 * FLOOR_TOP), (OUTER_HALF_X, OUTER_HALF_Y, 0.5 * FLOOR_TOP)),
        ("wall_px", (INNER_HALF_X + 0.5 * WALL, 0.0, wall_half_z), (0.5 * WALL, OUTER_HALF_Y, wall_half_z)),
        ("wall_nx", (-INNER_HALF_X - 0.5 * WALL, 0.0, wall_half_z), (0.5 * WALL, OUTER_HALF_Y, wall_half_z)),
        ("wall_py", (0.0, INNER_HALF_Y + 0.5 * WALL, wall_half_z), (INNER_HALF_X, 0.5 * WALL, wall_half_z)),
        ("wall_ny", (0.0, -INNER_HALF_Y - 0.5 * WALL, wall_half_z), (INNER_HALF_X, 0.5 * WALL, wall_half_z)),
    )


@register_entity("cube_in_tray_tray")
class EntityTray(EntityStatic):
    """A static that builds itself from :func:`tray_boxes`.

    World-hung in a single-world build, or on this static's own body in a
    replicated one, so an episode that moves the tray moves every piece with it.
    """

    claims_body = True

    def build(self, builder: newton.ModelBuilder, episode) -> None:
        self._claim_body(builder, episode)
        first = builder.shape_count
        if self.on_body:
            body, frame = self.body, (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        else:
            body, frame = -1, tuple(float(v) for v in self._placed(self.xform_now))
        rotation = wp.quat(*(float(v) for v in frame[3:7]))
        for label, centre, half in tray_boxes():
            position = transform_point(frame, centre)
            builder.add_shape_box(
                body=body,
                xform=wp.transform(tuple(float(v) for v in position), rotation),
                hx=float(half[0]),
                hy=float(half[1]),
                hz=float(half[2]),
                label=f"{self.spec.name}_{label}",
            )
        if self.spec.friction is not None:
            for shape in range(first, builder.shape_count):
                builder.shape_material_mu[shape] = float(self.spec.friction)
