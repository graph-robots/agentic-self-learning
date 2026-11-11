# SPDX-License-Identifier: Apache-2.0
"""Facts from a raw capture: what the recorded arrays mean, per point and per span.

RoboSimStudio records arrays and indices; this module decides what they mean
(where each body and hand is, what touches what, what a motion achieved
against what it was asked for). It produces structured facts only; the
language is :mod:`asl.feedback.design`'s.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import numpy as np

from .capture import RawPoint, RawSpan
from .schema import (
    ArmDelta,
    ArmFact,
    ContactFact,
    EntityDelta,
    EntityFact,
    GoalProgress,
    GraspGeometry,
    MotionSpanFact,
    PointFacts,
    StateDelta,
    TrajectorySummary,
    slim_point,
)


def _vector(value: Any, size: int) -> np.ndarray | None:
    try:
        array = np.asarray(value, dtype=np.float64).reshape(-1)
    except (TypeError, ValueError):
        return None
    return array[:size] if len(array) >= size else None


def _quat_multiply(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ],
        dtype=np.float64,
    )


def _rotate(q: np.ndarray, point: np.ndarray) -> np.ndarray:
    xyz = q[:3]
    return point + 2.0 * np.cross(xyz, np.cross(xyz, point) + q[3] * point)


def axes_from_up(features: dict[str, Any], pose: np.ndarray) -> dict[str, float]:
    """Angle from world up of every declared ``axis`` feature, in degrees.

    The feature's ``direction`` is stated in the body's frame; rotated by the
    live pose it is the axis in the world, and its angle against +z is the
    attitude a goal written between declared axes is scored on. 0 is the axis
    pointing up, 180 inverted.
    """
    if len(pose) < 7:
        return {}
    q = np.asarray(pose[3:7], dtype=np.float64)
    out: dict[str, float] = {}
    for name, spec in (features or {}).items():
        if not isinstance(spec, dict) or str(spec.get("kind", "")) != "axis":
            continue
        direction = _vector(spec.get("direction", ()), 3)
        if direction is None or float(np.linalg.norm(direction)) < 1e-9:
            continue
        world = _rotate(q, direction / np.linalg.norm(direction))
        out[str(name)] = round(float(np.degrees(np.arccos(np.clip(world[2], -1.0, 1.0)))), 1)
    return out


def _compose(body_pose: np.ndarray, offset: Any, offset_q: Any) -> list[float]:
    q = np.asarray(body_pose[3:7], dtype=np.float64)
    p = np.asarray(body_pose[:3], dtype=np.float64) + _rotate(q, np.asarray(offset, dtype=np.float64))
    rotation = _quat_multiply(q, np.asarray(offset_q, dtype=np.float64))
    return [float(v) for v in np.concatenate([p, rotation])]


def _angle(a: Iterable[float], b: Iterable[float]) -> float:
    qa, qb = np.asarray(tuple(a), dtype=np.float64), np.asarray(tuple(b), dtype=np.float64)
    na, nb = np.linalg.norm(qa), np.linalg.norm(qb)
    if na <= 0 or nb <= 0:
        return 0.0
    dot = float(np.clip(abs(np.dot(qa / na, qb / nb)), 0.0, 1.0))
    return float(2.0 * np.arccos(dot))


def _region_bounds(region: dict[str, Any], body_q: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    body = int(region.get("frame_body", -1))
    origin = (
        np.asarray(body_q[body][:3], dtype=np.float64)
        if 0 <= body < len(body_q)
        else np.asarray(region.get("origin", (0.0, 0.0, 0.0)), dtype=np.float64)
    )
    x0, y0, x1, y1 = (float(v) for v in region.get("xy_ranges", (0, 0, 0, 0)))
    z0, z1 = (float(v) for v in region.get("z_range", (0, 0)))
    lo = origin + np.array([min(x0, x1), min(y0, y1), min(z0, z1)])
    hi = origin + np.array([max(x0, x1), max(y0, y1), max(z0, z1)])
    return lo, hi


def _containment(points: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float:
    points = np.atleast_2d(np.asarray(points, dtype=np.float64))
    if not len(points):
        return 0.0
    return float(np.all((points >= lo) & (points <= hi), axis=1).mean())


def _xy_outside(position, lo: np.ndarray, hi: np.ndarray) -> float:
    """Distance from a point to a region's x/y footprint [m]; 0 inside it."""
    x, y = float(position[0]), float(position[1])
    dx = max(lo[0] - x, 0.0, x - hi[0])
    dy = max(lo[1] - y, 0.0, y - hi[1])
    return round(float(np.hypot(dx, dy)), 4)


def _z_offset(position, lo: np.ndarray, hi: np.ndarray) -> float:
    """Where a point sits relative to a region's z-window [m].

    Positive above the window, negative below, 0 inside — the sign convention
    that lets "on the lid" and "under the floor" read differently.
    """
    z = float(position[2])
    if z > hi[2]:
        return round(z - float(hi[2]), 4)
    if z < lo[2]:
        return round(z - float(lo[2]), 4)
    return 0.0


def _angle_between(target_wxyz: list[float] | None, achieved_xyzw: list[float] | None) -> float | None:
    """Angle [deg] between two orientations, or ``None`` if either is unknown.

    The two come from different places and in different layouts: a policy
    writes a pose as ``{"rotation": {"w","x","y","z"}}``, and the captured arm
    pose is an xyzw vector. Reconciling them here rather than at the call site
    keeps the one conversion in one place.
    """
    if not target_wxyz or not achieved_xyzw or len(achieved_xyzw) < 4:
        return None
    a = np.asarray([target_wxyz[1], target_wxyz[2], target_wxyz[3], target_wxyz[0]], dtype=np.float64)
    b = np.asarray(achieved_xyzw[:4], dtype=np.float64)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9:
        return None
    # q and -q are the same rotation, so the sign of the dot product carries no
    # information -- take its magnitude or every second frame reads as 180 off.
    dot = float(np.clip(abs(np.dot(a / na, b / nb)), 0.0, 1.0))
    return float(np.degrees(2.0 * np.arccos(dot)))



def is_grasp_attempt(tool: str, request: dict | None = None) -> bool:
    """Whether this span is a grasp attempt — the jaws (or an attach) commit.

    A verb test on the tool's own name, since no list of names covers every
    task's tools: close/grip/grasp/attach are attempts; open/release are the
    opposite gesture; check/get/plan are queries about grasping, not grasping.
    A request whose string arguments say "open" (a preset name, a mode) is an
    open regardless of the tool's name.
    """
    name = tool.rsplit(".", 1)[-1].lower()
    if any(k in name for k in ("open", "release", "check", "get", "plan")):
        return False
    if not any(k in name for k in ("close", "grip", "grasp", "attach")):
        return False
    for value in (request or {}).values():
        if isinstance(value, str) and "open" in value.lower():
            return False
    return True


def _bbox_list(record: dict) -> list[float]:
    """An entity's box extents as plain floats; empty when it has none.

    ``_vector`` returns a numpy array or None, and ``array or []`` is a truth
    test on an array -- which raises. Spelled out rather than golfed.
    """
    bbox = _vector((record or {}).get("bbox", ()), 3)
    return [] if bbox is None else [round(float(v), 5) for v in bbox]


def _feature_point(spec: dict) -> np.ndarray | None:
    """A declared feature's representative point, in the entity's own frame.

    A ``loop`` or a ``grasp_box`` states a ``center``; a ``rod`` or an ``axis``
    states two ends, and its midpoint is the honest single point to measure a
    grasp against. Anything else has no point and is skipped rather than
    guessed at.
    """
    center = spec.get("center")
    if isinstance(center, (list, tuple)) and len(center) >= 3:
        return np.asarray(center[:3], dtype=np.float64)
    axis = spec.get("axis")
    if isinstance(axis, (list, tuple)) and len(axis) >= 2:
        ends = np.asarray([axis[0][:3], axis[-1][:3]], dtype=np.float64)
        return ends.mean(axis=0)
    return None


def body_axes(
    pose: np.ndarray, world_vector: np.ndarray, bbox: np.ndarray | None
) -> tuple[list[float], list[float]]:
    """*world_vector* in the entity's own axes: ``[long, mid, short]``.

    **The one definition of "the object's frame" here.** Every derived offset
    goes through this function, so "long axis" means the same direction
    wherever the agent reads it.

    The frame is the body's, taken at the pose supplied — the world vector is
    rotated in by the conjugate quaternion — and the axes are ordered by the
    bounding box's extents, longest first, which is what makes the name "long
    axis" mean something an author can act on rather than an index. Without a
    box the body axes are returned in their own order, unsorted, and the
    caller should say so.

    Returns ``(components, dims)``; ``dims`` is empty when there is no box.
    """
    q = pose[3:7]
    conj = np.array([-q[0], -q[1], -q[2], q[3]])
    local = _rotate(conj, world_vector)
    if bbox is None:
        return [float(v) for v in local], []
    order = list(np.argsort(bbox)[::-1])
    return [float(local[i]) for i in order], [float(bbox[i]) for i in order]


def grasp_geometry(
    end_point: PointFacts,
    all_points: list[PointFacts],
    arm_id: int,
    manifest: dict[str, Any],
    *,
    span_id: int = 0,
    tool: str = "",
    node: str = "",
) -> GraspGeometry | None:
    """Where this close landed, from capture geometry alone.

    The object is whichever entity the fingers actually touched during the
    span (most contacts wins), falling back to the nearest movable entity
    within 15 cm of the hand. Offsets come out in the object's own box axes,
    longest first, because "8 mm beyond the end face" is actionable where a
    world-frame delta is not.
    """
    arm = next((a for a in end_point.arms if a.arm_id == arm_id), None)
    if arm is None or len(arm.ee_pose_xyzw) < 3:
        return None
    ee = np.asarray(arm.ee_pose_xyzw[:3], dtype=np.float64)

    finger_contacts: dict[str, list[str]] = {}
    hits: dict[str, int] = {}
    prefix = f"arm:{arm.name}:" if arm.name else "arm:"
    for point in all_points:
        for contact in point.contacts:
            for mine, other in ((contact.owner_a, contact.owner_b), (contact.owner_b, contact.owner_a)):
                if ":finger" not in mine or not mine.startswith(prefix):
                    continue
                finger = mine.split(":", 2)[-1]
                partner = other.split(":", 1)[1] if other.startswith("entity:") else None
                bucket = finger_contacts.setdefault(finger, [])
                if partner and partner not in bucket:
                    bucket.append(partner)
                # Statics are contact partners worth naming ("finger:0 -> table"
                # is the diagnosis) but never the reference frame: an offset
                # from the table's centre is noise wearing units. The vote for
                # the object the offsets are measured against is movables-only.
                partner_entity = end_point.entities.get(partner) if partner else None
                if partner_entity is not None and not partner_entity.static:
                    hits[partner] = hits.get(partner, 0) + 1

    target: str | None = max(hits, key=hits.get) if hits else None
    if target is None:
        best = None
        for name, entity in end_point.entities.items():
            if entity.static or len(entity.pose_xyzw) < 3:
                continue
            dist = float(np.linalg.norm(np.asarray(entity.pose_xyzw[:3]) - ee))
            if dist < 0.15 and (best is None or dist < best[1]):
                best = (name, dist)
        target = best[0] if best else None

    dims_ordered: list[float] = []
    offset_axes: list[float] = []
    outside: list[float] = []
    entity = end_point.entities.get(target) if target else None
    record = (manifest.get("entities") or {}).get(target) if target else None
    bbox = _vector((record or {}).get("bbox", ()), 3)
    if entity is not None and len(entity.pose_xyzw) >= 7:
        pose = np.asarray(entity.pose_xyzw, dtype=np.float64)
        offset_axes, dims_ordered = body_axes(pose, ee - pose[:3], bbox)
        outside = [max(0.0, abs(o) - d / 2.0) for o, d in zip(offset_axes, dims_ordered, strict=False)]

    nearest = ""
    if entity is not None and offset_axes and getattr(entity, "features", None):
        # Both are in the entity's own frame already -- the offset because
        # body_axes put it there, the feature because that is how an asset
        # declares it -- so this is a distance, not a transform.
        local_raw = _rotate(
            np.array([-entity.pose_xyzw[3], -entity.pose_xyzw[4], -entity.pose_xyzw[5], entity.pose_xyzw[6]]),
            ee - np.asarray(entity.pose_xyzw[:3], dtype=np.float64),
        )
        best: tuple[str, float] | None = None
        for feature, spec in (entity.features or {}).items():
            point = _feature_point(spec)
            if point is None:
                continue
            distance = float(np.linalg.norm(local_raw - point))
            if best is None or distance < best[1]:
                best = (str(feature), distance)
        if best is not None:
            nearest = f"{best[0]} {1e3 * best[1]:.0f} mm"

    fingers_on_target = target is not None and any(target in v for v in finger_contacts.values())
    touched_anything = any(partners for partners in finger_contacts.values())
    closed_on = "object" if fingers_on_target else ("other" if touched_anything else "nothing")
    aperture = float(np.mean(arm.gripper_q)) if arm.gripper_q else None
    return GraspGeometry(
        span_id=span_id,
        arm_id=arm_id,
        tool=tool,
        node=node,
        ee_position=[round(float(v), 4) for v in ee],
        aperture_end=round(aperture, 4) if aperture is not None else None,
        object_name=target,
        object_dims_m=[round(v, 4) for v in dims_ordered],
        offset_axes_m=[round(v, 4) for v in offset_axes],
        outside_faces_m=[round(v, 4) for v in outside],
        nearest_feature=nearest,
        finger_contacts=finger_contacts,
        closed_on=closed_on,
    )

class FactExtractor:
    """Derive named facts from any source satisfying the raw capture protocol."""

    def __init__(
        self,
        *,
        moved_threshold_m: float = 0.005,
        rest_speed_m_s: float = 0.02,
        contact_impulse_ns: float = 1.0e-6,
        planned_targets: dict[str, list[float]] | None = None,
    ) -> None:
        self.moved_threshold_m = float(moved_threshold_m)
        self.rest_speed_m_s = float(rest_speed_m_s)
        self.contact_impulse_ns = float(contact_impulse_ns)
        self.planned_targets = dict(planned_targets or {})
        self.planned_rotations: dict[str, list[float]] = {}
        """Cartesian target per node, for spans whose own request has none.

        A common idiom is ``motion.plan_linear(end=…)`` followed by
        ``robot.execute_trajectory(trajectory=…)``: only the first names a place
        in the world, and the second, which moves the arm, carries joint
        waypoints. The two calls belong to the same node, which ties the moving
        span back to its target."""

    def point(self, point: RawPoint) -> PointFacts:
        manifest = point.manifest
        body_q = np.asarray(point.arrays.get("body_q", np.zeros((0, 7))), dtype=np.float64)
        body_qd = np.asarray(point.arrays.get("body_qd", np.zeros((0, 6))), dtype=np.float64)
        joint_q = np.asarray(point.arrays.get("joint_q", np.zeros(0)), dtype=np.float64)
        contacts = self._contacts(point)

        entities: dict[str, EntityFact] = {}
        for name, record in sorted((manifest.get("entities") or {}).items()):
            body = int(record.get("body", -1))
            pose = (
                np.asarray(body_q[body][:7], dtype=np.float64)
                if 0 <= body < len(body_q)
                else np.asarray(record.get("xform_xyzw", ()), dtype=np.float64)
            )
            if len(pose) < 7:
                continue
            speed = float(np.linalg.norm(body_qd[body][:3])) if 0 <= body < len(body_qd) else None
            fractions = self._regions(pose[:3][None, :], manifest, body_q)
            static = bool(record.get("static", False))
            at_rest = (speed < self.rest_speed_m_s) if speed is not None else None
            entities[name] = EntityFact(
                name=name,
                bbox_m=_bbox_list(record),
                features={
                    str(k): dict(v)
                    for k, v in (record.get("features") or {}).items()
                    if isinstance(v, dict)
                },
                kind=str(record.get("kind", "")),
                asset_type=str(record.get("asset_type", "")),
                static=static,
                pose_xyzw=[float(v) for v in pose[:7]],
                linear_speed_m_s=speed,
                at_rest=at_rest,
                region_fractions=fractions,
                long_axis_from_vertical_deg=None if static else self._attitude(record, pose),
                axes_from_up_deg={} if static else axes_from_up(record.get("features") or {}, pose),
                resting_on=self._support(name, at_rest, contacts) if not static else None,
                above_region_m={} if static else self._above_regions(pose[:3], fractions, manifest, body_q),
            )

        particles = np.asarray(point.arrays.get("particle_q", np.zeros((0, 3))), dtype=np.float64)
        particle_qd = np.asarray(point.arrays.get("particle_qd", np.zeros((0, 3))), dtype=np.float64)
        for name, record in sorted((manifest.get("cloths") or {}).items()):
            indices = np.asarray(record.get("particles", ()), dtype=np.int64)
            indices = indices[(indices >= 0) & (indices < len(particles))]
            cloud = particles[indices, :3] if len(indices) else np.zeros((0, 3))
            centroid = cloud.mean(axis=0) if len(cloud) else np.zeros(3)
            valid_v = indices[indices < len(particle_qd)]
            speed = float(np.linalg.norm(particle_qd[valid_v, :3], axis=1).max()) if len(valid_v) else None
            entities[name] = EntityFact(
                name=name,
                kind="cloth",
                pose_xyzw=[*map(float, centroid), 0.0, 0.0, 0.0, 1.0],
                linear_speed_m_s=speed,
                at_rest=(speed < self.rest_speed_m_s) if speed is not None else None,
                region_fractions=self._regions(cloud, manifest, body_q),
                extent_m=(
                    [round(float(v), 4) for v in (cloud.max(axis=0) - cloud.min(axis=0))]
                    if len(cloud) else None
                ),
            )

        arms = [
            self._arm(name, record, body_q, joint_q, contacts, manifest)
            for name, record in sorted(
                (manifest.get("arms") or {}).items(), key=lambda item: int(item[1].get("arm_id", 0))
            )
        ]
        return PointFacts(
            step=int(point.step),
            sim_time=float(point.sim_time),
            entities=entities,
            arms=arms,
            contacts=contacts,
        )

    def delta(self, before: PointFacts, after: PointFacts) -> StateDelta:
        entities: dict[str, EntityDelta] = {}
        for name in sorted(set(before.entities) & set(after.entities)):
            first, last = before.entities[name], after.entities[name]
            p0, p1 = np.asarray(first.pose_xyzw[:3]), np.asarray(last.pose_xyzw[:3])
            displacement = float(np.linalg.norm(p1 - p0))
            rotation = _angle(first.pose_xyzw[3:7], last.pose_xyzw[3:7])
            regions = set(first.region_fractions) | set(last.region_fractions)
            entered = sorted(
                region for region in regions
                if first.region_fractions.get(region, 0.0) <= 0 < last.region_fractions.get(region, 0.0)
            )
            left = sorted(
                region for region in regions
                if first.region_fractions.get(region, 0.0) > 0 >= last.region_fractions.get(region, 0.0)
            )
            fraction_delta = {
                region: round(last.region_fractions.get(region, 0.0) - first.region_fractions.get(region, 0.0), 6)
                for region in sorted(regions)
                if abs(last.region_fractions.get(region, 0.0) - first.region_fractions.get(region, 0.0)) > 1e-6
            }
            if (
                displacement < self.moved_threshold_m
                and rotation < 1e-3
                and not entered
                and not left
                and not fraction_delta
                and first.at_rest == last.at_rest
            ):
                continue
            bbox = np.asarray(first.bbox_m, dtype=np.float64) if len(first.bbox_m) == 3 else None
            axes, _dims = (
                body_axes(np.asarray(first.pose_xyzw, dtype=np.float64), p1 - p0, bbox)
                if len(first.pose_xyzw) >= 7
                else ([], [])
            )
            entities[name] = EntityDelta(
                displacement_m=round(displacement, 6),
                displacement_axes_m=[round(v, 6) for v in axes] if bbox is not None else [],
                orientation_change_rad=round(rotation, 6),
                before_position=[float(v) for v in p0],
                after_position=[float(v) for v in p1],
                before_speed_m_s=first.linear_speed_m_s,
                after_speed_m_s=last.linear_speed_m_s,
                at_rest=last.at_rest,
                entered=entered,
                left=left,
                region_fraction_delta=fraction_delta,
            )

        arms: list[ArmDelta] = []
        first_arms = {arm.arm_id: arm for arm in before.arms}
        for last in after.arms:
            first = first_arms.get(last.arm_id)
            if first is None:
                continue
            moved = float(
                np.linalg.norm(np.asarray(last.ee_pose_xyzw[:3]) - np.asarray(first.ee_pose_xyzw[:3]))
            ) if first.ee_pose_xyzw and last.ee_pose_xyzw else 0.0
            grasped = last.holding if last.holding and last.holding != first.holding else None
            released = first.holding if first.holding and first.holding != last.holding else None
            if moved >= self.moved_threshold_m or grasped or released:
                arms.append(
                    ArmDelta(
                        arm_id=last.arm_id,
                        name=last.name,
                        ee_displacement_m=round(moved, 6),
                        grasped=grasped,
                        released=released,
                        holding_after=last.holding,
                    )
                )

        first_contacts = self._contact_labels(before.contacts)
        last_contacts = self._contact_labels(after.contacts)
        return StateDelta(
            start_step=before.step,
            end_step=after.step,
            elapsed_s=round(after.sim_time - before.sim_time, 6),
            entities=entities,
            arms=arms,
            contacts_started=sorted(last_contacts - first_contacts),
            contacts_ended=sorted(first_contacts - last_contacts),
        )

    def span(self, span: RawSpan) -> MotionSpanFact:
        before, after = self.point(span.before), self.point(span.after)
        points = [self.point(point) for point in span.points()]
        arm_id = int(span.metadata.get("arm_id", 0) or 0)
        trajectory = self._trajectory(points, arm_id)
        request = dict(span.metadata.get("request") or {})
        target = self._find_position(request)
        node_name = str(span.metadata.get("node", ""))
        if target is None:
            target = self.planned_targets.get(node_name)
        target_quat = self.planned_rotations.get(node_name)
        achieved_arm = next((arm for arm in after.arms if arm.arm_id == arm_id), None)
        achieved = achieved_arm.ee_pose_xyzw[:3] if achieved_arm and achieved_arm.ee_pose_xyzw else None
        if achieved is not None and not all(np.isfinite(v) for v in achieved):
            # A diverged simulation reads NaN here; serialized as JSON null it
            # made the archived packet unloadable. Absent is the honest value.
            achieved = None
        position_error = (
            float(np.linalg.norm(np.asarray(target) - np.asarray(achieved)))
            if target is not None and achieved is not None
            else None
        )
        achieved_quat = (
            achieved_arm.ee_pose_xyzw[3:7]
            if achieved_arm and achieved_arm.ee_pose_xyzw else None
        )
        rotation_error = _angle_between(target_quat, achieved_quat)
        result = span.metadata.get("result")
        tool_name = str(span.metadata.get("tool", ""))
        deficit = None
        waypoints = (request.get("trajectory") or {}).get("waypoints") if isinstance(request.get("trajectory"), dict) else None
        if (
            isinstance(waypoints, (list, tuple)) and waypoints
            and achieved_arm is not None and achieved_arm.joint_q
            and isinstance(waypoints[-1], (list, tuple))
        ):
            final = np.asarray(waypoints[-1], dtype=np.float64).reshape(-1)
            lived = np.asarray(achieved_arm.joint_q, dtype=np.float64)
            n = min(len(final), len(lived))
            if n:
                deficit = round(float(np.max(np.abs(final[:n] - lived[:n]))), 4)
        grasp = (
            grasp_geometry(
                after, points or [after], arm_id, span.after.manifest,
                span_id=int(span.metadata.get("span_id", span.id)),
                tool=tool_name, node=node_name,
            )
            if is_grasp_attempt(tool_name, request)
            else None
        )
        return MotionSpanFact(
            span_id=int(span.metadata.get("span_id", span.id)),
            tool=tool_name,
            node=str(span.metadata.get("node", "")),
            arm_id=arm_id,
            status=str(span.metadata.get("status", "")),
            start_step=before.step,
            end_step=after.step,
            request=request,
            result=result,
            error=span.metadata.get("error"),
            delta=self.delta(before, after),
            trajectory=trajectory,
            grasp=grasp,
            tracking_deficit_rad=deficit,
            target_position=target,
            achieved_position=achieved,
            position_error_m=round(position_error, 6) if position_error is not None else None,
            rotation_error_deg=round(rotation_error, 2) if rotation_error is not None else None,
            reported_residuals=self._residuals(result),
            after_state=slim_point(after),
        )

    ELONGATION = 1.4
    """How much longer the longest box axis must be than the next before an
    attitude is worth stating. A near-cubic body has no long axis; reporting
    one anyway would print noise wearing units."""

    def _attitude(self, record: dict[str, Any], pose: np.ndarray) -> float | None:
        """Angle of the body's longest box axis from world z [deg], or None.

        An absolute attitude, where a span's rotation is a relative change:
        is the object upright, or still flat?
        """
        bbox = _vector(record.get("bbox", ()), 3)
        if bbox is None:
            return None
        order = np.argsort(bbox)
        if bbox[order[-1]] < self.ELONGATION * max(bbox[order[-2]], 1e-9):
            return None
        x, y, z, w = (float(v) for v in pose[3:7])
        # Column order[-1] of the rotation matrix: the long local axis in world.
        columns = (
            (1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)),
            (2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)),
            (2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)),
        )
        axis_z = columns[int(order[-1])][2]
        return round(float(np.degrees(np.arccos(np.clip(abs(axis_z), 0.0, 1.0)))), 1)

    @staticmethod
    def _support(name: str, at_rest: bool | None, contacts: list[ContactFact]) -> str | None:
        """What a resting entity is resting on, from its live contacts."""
        if not at_rest:
            return None
        me = f"entity:{name}"
        partners = sorted(
            {other.split(":", 1)[1]
             for contact in contacts
             for mine, other in ((contact.owner_a, contact.owner_b), (contact.owner_b, contact.owner_a))
             if mine == me and other.startswith("entity:")}
        )
        return partners[0] if partners else None

    def _above_regions(
        self,
        position: np.ndarray,
        fractions: dict[str, float],
        manifest: dict[str, Any],
        body_q: np.ndarray,
    ) -> dict[str, float]:
        """Regions this point hovers over: inside their x/y footprint, above their z window."""
        out: dict[str, float] = {}
        point = np.asarray(position[:3], dtype=np.float64)
        for name, region in sorted((manifest.get("regions") or {}).items()):
            if fractions.get(name, 0.0) > 0:
                continue
            lo, hi = _region_bounds(region, body_q)
            if lo[0] <= point[0] <= hi[0] and lo[1] <= point[1] <= hi[1] and point[2] > hi[2]:
                out[name] = round(float(point[2] - hi[2]), 4)
        return out

    def goal_progress(
        self,
        goals: list[tuple[str, str, bool | None]],
        before: PointFacts,
        after: PointFacts,
        end_point: RawPoint,
    ) -> list[GoalProgress]:
        """Graded distance-to-goal for each placement goal, start against end.

        *goals* is ``(object, region, satisfied)`` in the evaluator's own
        vocabulary; geometry comes from the manifest's region records at the
        episode's end pose, the same source the region fractions use. Goals
        whose object or region the capture does not know are skipped rather
        than guessed at.
        """
        manifest = end_point.manifest
        body_q = np.asarray(end_point.arrays.get("body_q", np.zeros((0, 7))), dtype=np.float64)
        regions = manifest.get("regions") or {}
        out: list[GoalProgress] = []
        for object_name, region_name, satisfied in goals:
            entity_end = after.entities.get(object_name)
            region = regions.get(region_name)
            if entity_end is None or region is None:
                continue
            lo, hi = _region_bounds(region, body_q)
            entity_start = before.entities.get(object_name)
            held = any(arm.holding == object_name for arm in after.arms)
            out.append(
                GoalProgress(
                    object_name=object_name,
                    region_name=region_name,
                    satisfied=satisfied,
                    fraction_end=float(entity_end.region_fractions.get(region_name, 0.0)),
                    xy_distance_start_m=(
                        _xy_outside(entity_start.pose_xyzw[:3], lo, hi)
                        if entity_start is not None else None
                    ),
                    xy_distance_end_m=_xy_outside(entity_end.pose_xyzw[:3], lo, hi),
                    z_offset_end_m=_z_offset(entity_end.pose_xyzw[:3], lo, hi),
                    held_at_end=held,
                    at_rest_end=entity_end.at_rest,
                )
            )
        return out

    def _regions(
        self,
        points: np.ndarray,
        manifest: dict[str, Any],
        body_q: np.ndarray,
    ) -> dict[str, float]:
        out: dict[str, float] = {}
        for name, region in sorted((manifest.get("regions") or {}).items()):
            lo, hi = _region_bounds(region, body_q)
            fraction = _containment(points, lo, hi)
            if fraction > 0:
                out[name] = round(fraction, 6)
        return out

    def _contacts(self, point: RawPoint) -> list[ContactFact]:
        owners = self._shape_owners(point.manifest)
        out: list[ContactFact] = []
        for row in point.contacts:
            impulse = _vector(row.get("impulse", ()), 3)
            impulse = impulse if impulse is not None else np.zeros(3)
            distance = float(row.get("distance", 0.0))
            norm = float(np.linalg.norm(impulse))
            if norm < self.contact_impulse_ns and distance > 0:
                continue
            a, b = int(row.get("shape_a", -1)), int(row.get("shape_b", -1))
            out.append(
                ContactFact(
                    shape_a=a,
                    shape_b=b,
                    owner_a=owners.get(a, f"shape:{a}"),
                    owner_b=owners.get(b, f"shape:{b}"),
                    impulse_ns=[float(v) for v in impulse],
                    impulse_norm_ns=norm,
                    distance_m=distance,
                )
            )
        return out

    @staticmethod
    def _shape_owners(manifest: dict[str, Any]) -> dict[int, str]:
        owners: dict[int, str] = {}
        for name, entity in (manifest.get("entities") or {}).items():
            for shape in entity.get("shapes", ()):
                owners[int(shape)] = f"entity:{name}"
        for name, arm in (manifest.get("arms") or {}).items():
            for shape in arm.get("shapes", ()):
                owners[int(shape)] = f"arm:{name}"
            for side, shapes in enumerate(arm.get("finger_shapes", ())):
                for shape in shapes:
                    owners[int(shape)] = f"arm:{name}:finger:{side}"
        return owners

    def _arm(
        self,
        name: str,
        record: dict[str, Any],
        body_q: np.ndarray,
        joint_q: np.ndarray,
        contacts: list[ContactFact],
        manifest: dict[str, Any],
    ) -> ArmFact:
        ee_body = int(record.get("ee_body", -1))
        ee_pose = (
            _compose(
                body_q[ee_body],
                record.get("ee_offset", (0, 0, 0)),
                record.get("ee_offset_rot_xyzw", (0, 0, 0, 1)),
            )
            if 0 <= ee_body < len(body_q)
            else []
        )
        arm_coords = [int(v) for v in record.get("arm_coords", ())]
        gripper_coords = [int(v) for v in record.get("gripper_coords", ())]
        holding, sides = self._holding(name, record, contacts, manifest)
        return ArmFact(
            arm_id=int(record.get("arm_id", 0)),
            name=name,
            role=str(record.get("role", "")),
            ee_pose_xyzw=ee_pose,
            joint_q=[float(joint_q[i]) for i in arm_coords if 0 <= i < len(joint_q)],
            gripper_q=[float(joint_q[i]) for i in gripper_coords if 0 <= i < len(joint_q)],
            holding=holding,
            holding_contact_sides=sides,
        )

    def _holding(
        self,
        arm_name: str,
        arm: dict[str, Any],
        contacts: list[ContactFact],
        manifest: dict[str, Any],
    ) -> tuple[str | None, int]:
        sides = [set(map(int, shapes)) for shapes in arm.get("finger_shapes", ())]
        if not sides:
            return None, 0
        best_name, best_sides = None, 0
        for name, entity in (manifest.get("entities") or {}).items():
            if entity.get("kind") != "object":
                continue
            shapes = set(map(int, entity.get("collision_shapes") or entity.get("shapes") or ()))
            touched = 0
            for side in sides:
                if any(
                    ({contact.shape_a, contact.shape_b} & side)
                    and ({contact.shape_a, contact.shape_b} & shapes)
                    for contact in contacts
                ):
                    touched += 1
            if touched > best_sides:
                best_name, best_sides = name, touched
        return (best_name if best_sides == len(sides) else None), best_sides

    def _trajectory(self, points: list[PointFacts], arm_id: int) -> TrajectorySummary:
        ee: list[np.ndarray] = []
        entity_points: dict[str, list[np.ndarray]] = {}
        contact_pairs: set[str] = set()
        for point in points:
            arm = next((item for item in point.arms if item.arm_id == arm_id), None)
            if arm and arm.ee_pose_xyzw:
                ee.append(np.asarray(arm.ee_pose_xyzw[:3], dtype=np.float64))
            for name, entity in point.entities.items():
                entity_points.setdefault(name, []).append(np.asarray(entity.pose_xyzw[:3], dtype=np.float64))
            contact_pairs |= self._contact_labels(point.contacts)
        ee_steps = [float(np.linalg.norm(b - a)) for a, b in zip(ee, ee[1:], strict=False)]
        paths = {
            name: round(
                sum(float(np.linalg.norm(b - a)) for a, b in zip(values, values[1:], strict=False)),
                6,
            )
            for name, values in entity_points.items()
            if len(values) > 1
        }
        return TrajectorySummary(
            point_count=len(points),
            duration_s=round(points[-1].sim_time - points[0].sim_time, 6) if len(points) > 1 else 0.0,
            ee_path_m=round(sum(ee_steps), 6),
            max_ee_step_m=round(max(ee_steps), 6) if ee_steps else 0.0,
            entity_path_m={name: value for name, value in paths.items() if value >= self.moved_threshold_m},
            contact_pairs=sorted(contact_pairs),
        )

    @staticmethod
    def _contact_labels(contacts: list[ContactFact]) -> set[str]:
        return {" ↔ ".join(sorted((contact.owner_a, contact.owner_b))) for contact in contacts}

    @classmethod
    def _find_position(cls, value: Any, *, key: str = "") -> list[float] | None:
        if isinstance(value, dict):
            if {"x", "y", "z"} <= set(value) and key in {"position", "pos", "target_position"}:
                return [float(value[axis]) for axis in ("x", "y", "z")]
            for preferred in ("target_position", "position", "pos", "pose", "target", "goal"):
                if preferred in value:
                    found = cls._find_position(value[preferred], key=preferred)
                    if found is not None:
                        return found
            for child_key, child in value.items():
                found = cls._find_position(child, key=str(child_key))
                if found is not None:
                    return found
        elif isinstance(value, (list, tuple)) and key in {"position", "pos", "target_position"}:
            vector = _vector(value, 3)
            return [float(v) for v in vector] if vector is not None else None
        return None

    @classmethod
    def _residuals(cls, value: Any, *, prefix: str = "") -> dict[str, float]:
        out: dict[str, float] = {}
        if not isinstance(value, dict):
            return out
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            lowered = str(key).lower()
            if isinstance(item, (int, float)) and any(
                token in lowered for token in ("error", "residual", "distance", "gap")
            ):
                out[path] = float(item)
            elif isinstance(item, dict) and len(out) < 8:
                out.update(cls._residuals(item, prefix=path))
            if len(out) >= 8:
                break
        return out
