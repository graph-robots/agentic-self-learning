# SPDX-License-Identifier: Apache-2.0
"""FEEDBACK.md: one feedback condition's rendering of a training batch.

A condition (``feedback`` in the config) fixes three things about the
simulation feedback the agent reads:

* **form** -- what beyond the outcome: ``visual`` stills, ``state`` numbers,
  ``relations`` predicates;
* **spatial** -- how space is written: ``positions`` (world xyz of whole
  objects), ``frames`` (+ orientations as axes, object-own axes, poses relative
  to the hand and to the target), ``parts`` (+ the assets' declared parts);
* **granularity** -- when: once per ``episode`` (start → end), per ``motion``
  primitive (every simulation-stepping tool call, labelled by its tool and
  commanded target, never by a node name), or per named graph step
  (``semantic``: each GaP node under the author's own names, rolled up to its
  subgraph, with its status and outputs).

Every condition is a projection of one packet (:mod:`asl.feedback.extract`
builds it with every fact), so two conditions differ only in what they
render, and a fact belongs to exactly one form and one spatial level. The
outcome block (success, steps, how each episode ended, the policy's own
raised errors) is in every condition; it is the program's output, not
simulation feedback.

Rules a reader of the code should be able to check:

* ``state`` lines carry numbers and no predicates; ``relations`` lines carry
  predicates and no numbers; neither appears without its form.
* ``positions`` never prints an orientation, an object-own axis or a part name;
  ``frames`` never prints a part name; only ``parts`` names a declared part.
* ``episode`` units never name a tool or a node; ``motion`` units name tools,
  never nodes; only ``semantic`` names nodes (outside the outcome's own error).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .schema import (
    EpisodeFeedback,
    FeedbackPacket,
    GoalProgress,
    MotionSpanFact,
    NodeTraceSummary,
    SlimEntity,
    SlimPoint,
    UnitFrame,
    slim_point,
)

__all__ = [
    "Condition",
    "Unit",
    "design_markdown",
    "representatives",
    "units_of",
    "view",
]

FORMS = ("visual", "state", "relations")
LEVELS = {"positions": 0, "frames": 1, "parts": 2}
ORIENTATION_WORDS = ("rot", "quat", "yaw", "roll", "pitch", "angle", "axis", "heading", "normal", "orient", "tilt", "deg")
MAX_UNITS = 40
"""Units rendered per episode before the tail is summarised (the failing
unit's neighbourhood always survives)."""

GOAL_VERBS = {
    "containment": "inside",
    "enclosure": "encloses",
    "threaded": "threaded through",
    "insertion": "seated in",
}


# ------------------------------------------------------------------ the condition


@dataclass(frozen=True)
class Condition:
    """One feedback condition, read once from its config."""

    form: frozenset[str]
    spatial: str = "parts"
    granularity: str = "semantic"
    max_frames: int = 16
    cameras: tuple[str, ...] = ()

    @classmethod
    def of(cls, spec: Any) -> Condition:
        doc = spec.model_dump() if hasattr(spec, "model_dump") else dict(spec or {})
        return cls(
            form=frozenset(doc.get("form") or ()),
            spatial=str(doc.get("spatial") or "parts"),
            granularity=str(doc.get("granularity") or "semantic"),
            max_frames=int(doc.get("max_frames") or 16),
            cameras=tuple(doc.get("cameras") or ()),
        )

    @property
    def state(self) -> bool:
        return "state" in self.form

    @property
    def relations(self) -> bool:
        return "relations" in self.form

    @property
    def visual(self) -> bool:
        return "visual" in self.form

    @property
    def world(self) -> bool:
        """Any simulation-state form (numbers or predicates) is shown."""
        return self.state or self.relations

    @property
    def level(self) -> int:
        return LEVELS.get(self.spatial, 2)

    def legend(self) -> str:
        forms = ", ".join(f for f in FORMS if f in self.form) or "none"
        unit = {
            "episode": "once per episode (start → end)",
            "motion": "per motion primitive (each simulation-stepping tool call)",
            "semantic": "per named graph step (each node of your workflow)",
        }[self.granularity]
        if not self.world and not self.visual:
            return "outcome only (success, steps, how each episode ended, your policy's own errors)"
        space = {
            "positions": "positions only (world x, y, z of whole objects)",
            "frames": "positions and orientations (coordinate frames)",
            "parts": "positions, orientations and the assets' declared parts",
        }[self.spatial]
        detail = f"simulation feedback: {forms}; {unit}"
        if self.world:
            detail += f"; space written as {space}"
        return "outcome + " + detail


def view(packet: FeedbackPacket, feedback: Any) -> FeedbackPacket:
    """The packet as one feedback condition's agent reads it (see :meth:`FeedbackPacket.view`)."""
    return packet.view(feedback)


# ------------------------------------------------------------------ geometry


def _q(values: Any) -> np.ndarray | None:
    try:
        q = np.asarray(values, dtype=np.float64).reshape(-1)
    except (TypeError, ValueError):
        return None
    if q.shape != (4,) or not np.all(np.isfinite(q)) or float(np.linalg.norm(q)) < 1e-9:
        return None
    return q / np.linalg.norm(q)


def _rotate(q: np.ndarray, v: Any) -> np.ndarray:
    u, w = q[:3], q[3]
    v = np.asarray(v, dtype=np.float64)
    return v + 2.0 * np.cross(u, np.cross(u, v) + w * v)


def _to_local(q: np.ndarray, v: Any) -> np.ndarray:
    return _rotate(np.array([-q[0], -q[1], -q[2], q[3]]), v)


def _angle_deg(q0: Any, q1: Any) -> float | None:
    a, b = _q(q0), _q(q1)
    if a is None or b is None:
        return None
    dot = abs(float(np.dot(a, b)))
    return math.degrees(2.0 * math.acos(min(1.0, dot)))


def _xyz(v: Any) -> str:
    return "[" + ", ".join(f"{float(x):.3f}" for x in list(v)[:3]) + "]"


def _dir(v: Any) -> str:
    return "[" + ", ".join(f"{float(x):+.2f}" for x in list(v)[:3]) + "]"


def _long_axis(entity: SlimEntity) -> np.ndarray | None:
    """World direction of an entity's longest box axis, when it has one."""
    q = _q(entity.quat_xyzw)
    if q is None or len(entity.bbox_m) != 3:
        return None
    order = np.argsort(entity.bbox_m)
    if entity.bbox_m[order[-1]] < 1.4 * max(entity.bbox_m[order[-2]], 1e-9):
        return None
    axis = np.zeros(3)
    axis[int(order[-1])] = 1.0
    return _rotate(q, axis)


def _own_axes(entity: SlimEntity | None, world_vec: np.ndarray) -> list[float]:
    """A world vector in an entity's own axes, longest box axis first."""
    if entity is None:
        return []
    q = _q(entity.quat_xyzw)
    if q is None or len(entity.bbox_m) != 3:
        return []
    local = _to_local(q, world_vec)
    return [float(local[i]) for i in list(np.argsort(entity.bbox_m)[::-1])]


def _axes_text(values: list[float]) -> str:
    names = ("long", "mid", "short")
    parts = [f"{1e3 * v:+.0f} mm {n}" for v, n in zip(values, names, strict=False) if abs(v) >= 5e-4]
    return ", ".join(parts) + " (its own axes)" if parts else ""


def _attitude_class_long(deg: float | None) -> str | None:
    if deg is None:
        return None
    if deg < 20:
        return "stands on end"
    if deg > 70:
        return "lies flat"
    return "is tilted"


def _attitude_class_axis(deg: float) -> str:
    if deg < 30:
        return "points up"
    if deg > 150:
        return "is inverted"
    if 60 <= deg <= 120:
        return "is on its side"
    return "is tilted"


# ------------------------------------------------------------------ units


@dataclass
class Unit:
    """One stretch of an episode the packet reports on as a whole."""

    key: str
    kind: str  # episode | motion | node
    spans: list[MotionSpanFact] = field(default_factory=list)
    node: NodeTraceSummary | None = None
    subgraph: str = ""
    before: SlimPoint | None = None
    after: SlimPoint | None = None
    start_step: int | None = None
    end_step: int | None = None
    failed: bool = False


def _ordered_nodes(ep: EpisodeFeedback) -> list[NodeTraceSummary]:
    ran = [n for n in ep.nodes if n.status not in ("", "pending")]
    if ran and all(n.started_at for n in ran):
        return sorted(ran, key=lambda n: float(n.started_at or 0.0))
    return ran


def _failing_node(ep: EpisodeFeedback) -> str | None:
    if ep.success:
        return None
    return ep.first_error_node()


def units_of(ep: EpisodeFeedback, granularity: str) -> list[Unit]:
    """The episode cut into the condition's units, each with its boundary snapshots."""
    start = slim_point(ep.point_start) if ep.point_start is not None else None
    end = slim_point(ep.point_end) if ep.point_end is not None else None
    spans = sorted(ep.motion_spans, key=lambda s: (s.start_step, s.span_id))
    failing = _failing_node(ep)
    if granularity == "episode":
        first = start.step if start is not None else (spans[0].start_step if spans else 0)
        last = end.step if end is not None else (spans[-1].end_step if spans else (ep.steps or 0))
        return [Unit(key="episode", kind="episode", spans=spans, before=start, after=end,
                     start_step=first, end_step=last, failed=not ep.success)]
    if granularity == "motion":
        units: list[Unit] = []
        previous = start
        for span in spans:
            units.append(Unit(
                key=f"span:{span.span_id}", kind="motion", spans=[span], before=previous,
                after=span.after_state, start_step=span.start_step, end_step=span.end_step,
            ))
            previous = span.after_state or previous
        if failing is not None and units:
            # The motion the error happened in -- or, for a node that raised
            # without moving, the last motion before it.
            owned = [u for u in units if u.spans[0].node == failing]
            (owned[-1] if owned else units[-1]).failed = True
        return units
    by_node: dict[str, list[MotionSpanFact]] = {}
    for span in spans:
        by_node.setdefault(span.node or "", []).append(span)
    units = []
    previous = start
    seen: set[str] = set()
    for node in _ordered_nodes(ep):
        mine = by_node.get(node.node, [])
        seen.add(node.node)
        after = next((s.after_state for s in reversed(mine) if s.after_state is not None), None)
        units.append(Unit(
            key=f"node:{node.node}", kind="node", spans=mine, node=node,
            subgraph=node.node.split(".", 1)[0] if "." in node.node else "",
            before=previous if mine else None, after=after if mine else None,
            start_step=mine[0].start_step if mine else None,
            end_step=mine[-1].end_step if mine else None,
            failed=(node.node == failing) or bool(node.error and not ep.success and failing is None),
        ))
        if after is not None:
            previous = after
    orphans = [s for s in spans if (s.node or "") not in seen]
    for span in orphans:
        # A span whose node the trace did not list (a trace written before the
        # node closed): still a unit, labelled by what the span recorded.
        units.append(Unit(
            key=f"node:{span.node or span.tool}", kind="node", spans=[span],
            node=NodeTraceSummary(node=span.node or span.tool, status=span.status),
            subgraph=(span.node or "").split(".", 1)[0] if "." in (span.node or "") else "",
            before=None, after=span.after_state, start_step=span.start_step, end_step=span.end_step,
        ))
    return units


# ------------------------------------------------------------------ naming


def _arm_ids(ep: EpisodeFeedback) -> dict[str, int]:
    point = ep.point_end or ep.point_start
    return {arm.name: arm.arm_id for arm in (point.arms if point else [])}


def _owner(label: str, arm_ids: dict[str, int]) -> str:
    if label.startswith("entity:"):
        return label.split(":", 1)[1]
    if label.startswith("arm:"):
        parts = label.split(":")
        name = parts[1] if len(parts) > 1 else ""
        arm = f"arm {arm_ids[name]}" if name in arm_ids else f"the {name} arm"
        return f"{arm}'s fingers" if "finger" in parts else arm
    return ""


def _pair(pair: str, arm_ids: dict[str, int]) -> tuple[str, str] | None:
    a, _, b = pair.partition(" ↔ ")
    oa, ob = _owner(a, arm_ids), _owner(b, arm_ids)
    if not oa or not ob or oa == ob:
        return None
    return tuple(sorted((oa, ob)))  # type: ignore[return-value]


def _movables(ep: EpisodeFeedback) -> set[str]:
    point = ep.point_end or ep.point_start
    if point is not None:
        return {name for name, e in point.entities.items() if not e.static}
    out: set[str] = set()
    for span in ep.motion_spans:
        if span.after_state is not None:
            out |= set(span.after_state.entities)
    return out


def _keeps_pair(pair: tuple[str, str], movables: set[str]) -> bool:
    return any(side in movables or side.endswith("'s fingers") for side in pair)


def _base(ref: str) -> str:
    return ref.split(".", 1)[0] if ref else ref


def _goal_label(goal: GoalProgress) -> str:
    return f"{goal.object_name}→{goal.region_name}"


# ------------------------------------------------------------------ unit facts


def _moves(unit: Unit, arm: Condition, ep: EpisodeFeedback) -> list[str]:
    """``state``: what moved over the unit, at the condition's spatial level."""
    lines: list[str] = []
    before, after = unit.before, unit.after
    if before is not None and after is not None:
        for name in sorted(set(before.entities) & set(after.entities)):
            b, a = before.entities[name], after.entities[name]
            if len(b.position) < 3 or len(a.position) < 3:
                continue
            delta = np.asarray(a.position[:3]) - np.asarray(b.position[:3])
            dist = float(np.linalg.norm(delta))
            turn = _angle_deg(b.quat_xyzw, a.quat_xyzw)
            if dist < 0.005 and (turn is None or turn < 1.0 or arm.level == 0):
                continue
            line = f"{name} moved {dist:.3f} m: {_xyz(b.position)} → {_xyz(a.position)}"
            if arm.level >= 1:
                own = _axes_text(_own_axes(b, delta))
                if own:
                    line += f" ({own})"
                if turn is not None and turn >= 1.0:
                    line += f"; turned {turn:.0f}°"
            if a.at_rest is not None:
                line += "; at rest" if a.at_rest else "; still moving"
            lines.append(line + ".")
        for arm_after in after.arms:
            arm_before = next((x for x in before.arms if x.arm_id == arm_after.arm_id), None)
            if arm_before is None or len(arm_after.ee_position) < 3 or len(arm_before.ee_position) < 3:
                continue
            moved = float(np.linalg.norm(np.asarray(arm_after.ee_position) - np.asarray(arm_before.ee_position)))
            if moved >= 0.005:
                lines.append(f"arm {arm_after.arm_id}'s hand moved {moved:.3f} m to {_xyz(arm_after.ee_position)}.")
        return lines
    # An archive without unit snapshots: the recorded span deltas.
    for span in unit.spans:
        for name, change in sorted((span.delta.entities or {}).items()):
            if change.displacement_m and len(change.before_position) >= 3 and len(change.after_position) >= 3:
                line = (
                    f"{name} moved {change.displacement_m:.3f} m: {_xyz(change.before_position)} → "
                    f"{_xyz(change.after_position)}"
                )
                if arm.level >= 1:
                    own = _axes_text(change.displacement_axes_m)
                    if own:
                        line += f" ({own})"
                    if change.orientation_change_rad >= 0.017:
                        line += f"; turned {math.degrees(change.orientation_change_rad):.0f}°"
                lines.append(line + ".")
    return lines


def _moved_names(unit: Unit) -> tuple[set[str], set[int]]:
    """Entities and hands that moved (5 mm) or turned (5°) over the unit."""
    entities: set[str] = set()
    hands: set[int] = set()
    before, after = unit.before, unit.after
    if before is None or after is None:
        for span in unit.spans:
            entities |= {n for n, c in (span.delta.entities or {}).items() if c.displacement_m >= 0.005}
            hands |= {a.arm_id for a in span.delta.arms if a.ee_displacement_m >= 0.005}
        return entities, hands
    for name in set(before.entities) & set(after.entities):
        b, a = before.entities[name], after.entities[name]
        if len(b.position) >= 3 and len(a.position) >= 3:
            moved = float(np.linalg.norm(np.asarray(a.position[:3]) - np.asarray(b.position[:3])))
            turn = _angle_deg(b.quat_xyzw, a.quat_xyzw) or 0.0
            if moved >= 0.005 or turn >= 5.0:
                entities.add(name)
    for hand in after.arms:
        prior = next((x for x in before.arms if x.arm_id == hand.arm_id), None)
        if prior is not None and len(hand.ee_position) >= 3 and len(prior.ee_position) >= 3:
            if float(np.linalg.norm(np.asarray(hand.ee_position) - np.asarray(prior.ee_position))) >= 0.005:
                hands.add(hand.arm_id)
    return entities, hands


def _pose_lines(
    point: SlimPoint,
    arm: Condition,
    *,
    entities: set[str] | None = None,
    hands: set[int] | None = None,
    positions: bool = True,
    turned_hands: set[int] | None = None,
) -> list[str]:
    """``state``: where the named entities and hands are in *point*, at the condition's level.

    ``positions=False`` inside a unit, whose moves already gave the positions:
    then only what a move line cannot carry -- orientation, the held object
    in the hand's frame -- and a hand's frame axes only if it turned.
    """
    lines: list[str] = []
    for name, entity in sorted(point.entities.items()):
        if entities is not None and name not in entities:
            continue
        if len(entity.position) < 3:
            continue
        bits = [f"at {_xyz(entity.position)}"] if positions else []
        if arm.level >= 1:
            axis = _long_axis(entity)
            if axis is not None and entity.long_axis_deg is not None:
                bits.append(f"long axis → {_dir(axis)} (world), {entity.long_axis_deg:.0f}° from vertical")
        if arm.level >= 2 and entity.axes_from_up_deg:
            bits.append(", ".join(f"`{name}.{k}` {v:.0f}° from world up" for k, v in sorted(entity.axes_from_up_deg.items())))
        if bits:
            lines.append(f"{name} " + "; ".join(bits) + ".")
    for hand in point.arms:
        if hands is not None and hand.arm_id not in hands and not (hand.holding and entities and hand.holding in entities):
            continue
        if len(hand.ee_position) < 3:
            continue
        bits = [f"at {_xyz(hand.ee_position)}"] if positions else []
        q = _q(hand.ee_quat_xyzw)
        if arm.level >= 1 and q is not None and (turned_hands is None or hand.arm_id in turned_hands):
            bits.append(
                f"hand frame axes x→{_dir(_rotate(q, [1, 0, 0]))} y→{_dir(_rotate(q, [0, 1, 0]))} "
                f"z→{_dir(_rotate(q, [0, 0, 1]))} (world)"
            )
        held = point.entities.get(hand.holding) if hand.holding else None
        if arm.level >= 1 and q is not None and held is not None and len(held.position) >= 3:
            offset = _to_local(q, np.asarray(held.position[:3]) - np.asarray(hand.ee_position[:3]))
            bits.append(f"{hand.holding}'s centre in the hand frame {_xyz(offset)}")
        if bits:
            lines.append(f"arm {hand.arm_id}'s hand " + "; ".join(bits) + ".")
    return lines


def _turned_hands(unit: Unit) -> set[int]:
    if unit.before is None or unit.after is None:
        return set()
    out: set[int] = set()
    for hand in unit.after.arms:
        prior = next((x for x in unit.before.arms if x.arm_id == hand.arm_id), None)
        turn = _angle_deg(prior.ee_quat_xyzw, hand.ee_quat_xyzw) if prior is not None else None
        if turn is not None and turn >= 5.0:
            out.add(hand.arm_id)
    return out


def _command(unit: Unit, arm: Condition) -> list[str]:
    """``state``: commanded against achieved, for the unit's motions."""
    lines: list[str] = []
    for span in unit.spans:
        bits: list[str] = []
        if span.position_error_m is not None:
            where = f" {_xyz(span.target_position)}" if span.target_position else ""
            bits.append(f"ended {span.position_error_m:.3f} m from its commanded target{where}")
        if arm.level >= 1 and span.rotation_error_deg is not None:
            bits.append(f"{span.rotation_error_deg:.0f}° from the commanded orientation")
        if span.tracking_deficit_rad is not None and span.tracking_deficit_rad > 0.05:
            bits.append(f"stopped {span.tracking_deficit_rad:.2f} rad short of its trajectory's final waypoint")
        if span.reported_residuals:
            shown = {
                k: round(v, 4) for k, v in span.reported_residuals.items()
                if arm.level >= 1 or not any(t in k.lower() for t in ORIENTATION_WORDS)
            }
            if shown:
                bits.append(f"tool-reported residuals {shown}")
        if bits:
            prefix = f"`{span.tool}`: " if unit.kind == "node" else ""
            lines.append(prefix + "; ".join(bits) + ".")
    return lines


def _grasp_state(unit: Unit, arm: Condition) -> list[str]:
    """``state``: where each close landed, in numbers."""
    lines: list[str] = []
    for span in unit.spans:
        grasp = span.grasp
        if grasp is None or len(grasp.ee_position) < 3:
            continue
        bits = [f"jaws closed at {_xyz(grasp.ee_position)}"]
        target = span.after_state.entities.get(grasp.object_name) if (span.after_state and grasp.object_name) else None
        if grasp.object_name and target is not None and len(target.position) >= 3:
            delta = np.asarray(grasp.ee_position[:3]) - np.asarray(target.position[:3])
            bits.append(f"{float(np.linalg.norm(delta)):.3f} m from {grasp.object_name}'s centre (world Δ {_xyz(delta)})")
        if arm.level >= 1 and grasp.object_name and grasp.offset_axes_m:
            bits.append(f"offset {_axes_text(grasp.offset_axes_m)}")
            beyond = [
                f"{1e3 * v:.0f} mm beyond its {n} face"
                for v, n in zip(grasp.outside_faces_m, ("long", "mid", "short"), strict=False) if v > 0
            ]
            if beyond:
                bits.append("; ".join(beyond))
        if arm.level >= 2 and grasp.nearest_feature:
            bits.append(f"nearest declared part: {grasp.nearest_feature}")
        if grasp.aperture_end is not None:
            bits.append(f"aperture {1e3 * grasp.aperture_end:.1f} mm")
        if grasp.moved_during_close_m is not None and grasp.moved_during_close_m >= 0.005:
            bits.append(f"the object moved {1e3 * grasp.moved_during_close_m:.0f} mm during the close")
        lines.append("; ".join(bits) + ".")
    return lines


def _contact_events(unit: Unit, arm_ids: dict[str, int], movables: set[str]) -> tuple[list, list, list]:
    """Contact pairs that began, ended, and began-and-ended inside the unit (net over its spans)."""
    began: list[tuple[str, str]] = []
    ended: list[tuple[str, str]] = []
    brief: list[tuple[str, str]] = []
    for span in unit.spans:
        for pair in span.delta.contacts_started:
            p = _pair(pair, arm_ids)
            if not p or not _keeps_pair(p, movables):
                continue
            if p in ended:
                ended.remove(p)
            elif p not in began:
                began.append(p)
        for pair in span.delta.contacts_ended:
            p = _pair(pair, arm_ids)
            if not p or not _keeps_pair(p, movables):
                continue
            if p in began:
                began.remove(p)
                if p not in brief:
                    brief.append(p)
            elif p not in ended:
                ended.append(p)
    return began, ended, brief


def _relation_facts(point: SlimPoint | None, arm: Condition) -> dict[str, str]:
    """``relations`` that hold in one snapshot: support, regions, grip, attitude class."""
    if point is None:
        return {}
    facts: dict[str, str] = {}
    for name, entity in sorted(point.entities.items()):
        for region, fraction in sorted(entity.regions.items()):
            facts[f"in:{name}:{region}"] = f"{name} is {'inside' if fraction >= 0.999 else 'partly inside'} {region}"
        for region in sorted(entity.above):
            facts[f"above:{name}:{region}"] = f"{name} is above {region}, outside it"
        if entity.resting_on:
            facts[f"rest:{name}"] = f"{name} rests on {entity.resting_on}"
        if arm.level >= 1:
            cls = _attitude_class_long(entity.long_axis_deg)
            if cls:
                facts[f"att:{name}"] = f"{name} {cls}"
        if arm.level >= 2:
            for axis_name, deg in sorted(entity.axes_from_up_deg.items()):
                facts[f"ax:{name}:{axis_name}"] = f"`{name}.{axis_name}` {_attitude_class_axis(deg)}"
    for hand in point.arms:
        if hand.holding:
            facts[f"hold:{hand.arm_id}"] = f"arm {hand.arm_id}'s fingers are closed on {hand.holding}"
    return facts


def _relation_changes(before: dict[str, str], after: dict[str, str]) -> list[str]:
    lines = [f"now {after[k]}." for k in after if before.get(k) != after[k]]
    lines += [f"no longer: {before[k]}." for k in before if k not in after]
    return lines


def _events(unit: Unit, arm: Condition, ep: EpisodeFeedback) -> list[str]:
    """``relations`` events inside the unit: contacts, grasps, releases, slips, regions."""
    ids = _arm_ids(ep)
    movables = _movables(ep)
    lines: list[str] = []
    if unit.kind == "episode":
        delta = ep.state_delta
        began = [p for p in (_pair(x, ids) for x in (delta.contacts_started if delta else [])) if p and _keeps_pair(p, movables)]
        ended = [p for p in (_pair(x, ids) for x in (delta.contacts_ended if delta else [])) if p and _keeps_pair(p, movables)]
        brief: list = []
        deltas = [delta]
    else:
        began, ended, brief = _contact_events(unit, ids, movables)
        deltas = [s.delta for s in unit.spans]
    lines += [f"{a} and {b} came into contact." for a, b in dict.fromkeys(began)]
    lines += [f"{a} and {b} stopped touching." for a, b in dict.fromkeys(ended)]
    lines += [f"{a} and {b} touched and separated again." for a, b in dict.fromkeys(brief)]
    for delta in deltas:
        if delta is None:
            continue
        for hand in delta.arms:
            if hand.grasped and hand.hold_confirmed:
                lines.append(f"arm {hand.arm_id} grasped {hand.grasped}, and it moved with the hand.")
            elif hand.grasped:
                lines.append(f"arm {hand.arm_id} closed around {hand.grasped}, but it never moved with the hand.")
            if hand.released:
                lines.append(f"arm {hand.arm_id} let go of {hand.released}.")
        for name, change in sorted((delta.entities or {}).items()):
            lines += [f"{name} entered {r}." for r in change.entered]
            lines += [f"{name} left {r}." for r in change.left]
    if unit.kind != "episode":
        for span in unit.spans:
            g = span.grasp
            if g is not None and g.object_name:
                if g.ejected:
                    lines.append(f"the close threw {g.object_name} out of the jaws.")
                elif g.closed_on == "object":
                    lines.append(f"the close met {g.object_name}.")
                elif g.closed_on == "other":
                    lines.append(f"the close met something other than {g.object_name}.")
                elif g.closed_on == "nothing":
                    lines.append("the close met nothing.")
                if arm.level >= 2 and g.nearest_feature:
                    lines.append(f"the jaws closed nearest {g.object_name}'s `{g.nearest_feature.split(' ')[0]}`.")
            verb = (span.tool or "").rsplit(".", 1)[-1].lower()
            if span.delta is None or "release" in verb or "open" in verb:
                continue
            for hand in span.delta.arms:
                if hand.released:
                    partners = [
                        p for p in (_pair(x, ids) for x in span.delta.contacts_started)
                        if p and hand.released in p and not any(s.endswith("'s fingers") for s in p)
                    ]
                    note = f"{hand.released} slipped out of arm {hand.arm_id}'s hand"
                    if partners:
                        other = next(s for s in partners[0] if s != hand.released)
                        note += f" as it touched {other}"
                    lines.append(note + ".")
    return list(dict.fromkeys(lines))


def _target_entity(ep: EpisodeFeedback, goal: GoalProgress):
    point = ep.point_end or ep.point_start
    if point is None:
        return None
    return point.entities.get(_base(goal.region_name))


def _goal_reading(unit: Unit, goal: GoalProgress) -> dict[str, Any] | None:
    for span in reversed(unit.spans):
        if _goal_label(goal) in span.goal_states:
            return span.goal_states[_goal_label(goal)]
    return None


def _goal_predicate(goal: GoalProgress, arm: Condition, ok: bool | None, *, final: bool) -> str | None:
    """``relations``: a goal's predicate, object-level below ``parts``."""
    if ok is None:
        return None
    if goal.family == "fraction":
        return f"{goal.object_name}: target {'reached' if ok else 'not reached'}."
    if arm.level >= 2:
        return f"{goal.object_name} {GOAL_VERBS.get(goal.family, 'meets')} {goal.region_name}: {'yes' if ok else 'no'}."
    subject = goal.subject or _base(goal.object_name)
    target = goal.region_name if goal.family == "containment" else _base(goal.region_name)
    if final:
        return f"{subject} → {target}: goal {'met' if ok else 'not met'}."
    return f"{subject} → {target}: goal geometry {'holds' if ok else 'does not hold'}."


def _goal_numbers(unit: Unit, arm: Condition, ep: EpisodeFeedback, goal: GoalProgress, *, final: bool) -> list[str]:
    """``state``: a goal's distances at the unit's end, at the condition's spatial level."""
    subject = goal.subject or _base(goal.object_name)
    lines: list[str] = []
    if goal.family == "fraction":
        return [f"{goal.object_name} = {goal.fraction_end:.2f} at the end."] if final else []
    if goal.family == "containment":
        if final:
            if goal.xy_distance_end_m is not None:
                lines.append(f"{subject} ended {goal.xy_distance_end_m:.3f} m outside {goal.region_name}'s footprint in x-y.")
            if goal.z_offset_end_m:
                side = "above" if goal.z_offset_end_m > 0 else "below"
                lines.append(f"{subject} ended {abs(goal.z_offset_end_m):.3f} m {side} {goal.region_name}'s height window.")
            return lines
        reading = _goal_reading(unit, goal)
        if reading is not None and reading.get("distance_m") is not None:
            lines.append(f"{subject} is {reading['distance_m']:.3f} m from {goal.region_name}.")
        return lines
    entity = unit.after.entities.get(subject) if unit.after else None
    target = _target_entity(ep, goal)
    target_name = _base(goal.region_name)
    if arm.level <= 1 and entity is not None and target is not None and len(entity.position) >= 3:
        delta = np.asarray(entity.position[:3]) - np.asarray(target.pose_xyzw[:3])
        line = f"{subject}'s centre is {float(np.linalg.norm(delta)):.3f} m from {target_name}'s origin (world Δ {_xyz(delta)})"
        tq = _q(target.pose_xyzw[3:7])
        if arm.level >= 1 and tq is not None:
            line += f"; in {target_name}'s frame {_xyz(_to_local(tq, delta))}"
        lines.append(line + ".")
    if arm.level >= 2:
        if final:
            lines += _part_geometry(goal)
        else:
            reading = _goal_reading(unit, goal)
            if reading is not None and reading.get("distance_m") is not None:
                lines.append(f"{goal.object_name} to {goal.region_name}: {reading['distance_m']:.3f} m.")
    return lines


def _part_geometry(goal: GoalProgress) -> list[str]:
    """``state`` at ``parts``: the family's own part-level readings at the end."""
    out: list[str] = []
    loop, rod = goal.object_name, goal.region_name
    if goal.family == "enclosure":
        if goal.xy_distance_end_m is not None:
            out.append(f"{loop} to {rod}: {goal.xy_distance_end_m:.3f} m at the end.")
        if len(goal.feature_offset_m) == 3:
            along, vertical, lateral = goal.feature_offset_m
            out.append(
                f"{loop}'s centre relative to {rod}'s tip: {1e3 * along:+.0f} mm along it, "
                f"{1e3 * vertical:+.0f} mm vertical, {1e3 * lateral:+.0f} mm aside."
            )
        if goal.plane_tilt_deg is not None:
            out.append(f"{loop}'s plane is {goal.plane_tilt_deg:.0f}° off {rod}'s axis.")
    elif goal.family == "threaded":
        if len(goal.tip_offset_m) == 2:
            along, lateral = goal.tip_offset_m
            out.append(f"{rod}'s nearer end: {1e3 * along:+.0f} mm along {loop}'s normal, {1e3 * lateral:.0f} mm off its centre in-plane.")
        if goal.plane_tilt_deg is not None:
            out.append(f"{rod}'s axis is {goal.plane_tilt_deg:.0f}° off {loop}'s normal.")
        if len(goal.target_center) == 3:
            out.append(f"{loop}'s centre is at {_xyz(goal.target_center)} (world).")
        if goal.xy_distance_end_m is not None:
            out.append(f"{loop}'s centre to {rod}: {goal.xy_distance_end_m:.3f} m.")
    elif goal.family == "insertion":
        bits = []
        if goal.z_offset_end_m is not None:
            bits.append(f"tip {1e3 * goal.z_offset_end_m:+.1f} mm past {rod}'s mouth")
        if goal.xy_distance_end_m is not None:
            bits.append(f"{1e3 * goal.xy_distance_end_m:.1f} mm off its axis")
        if goal.xy_distance_start_m is not None:
            bits.append(f"tilted {math.degrees(goal.xy_distance_start_m):.1f}°")
        if bits:
            out.append(f"{loop} in {rod}: " + ", ".join(bits) + ".")
    return out


# ------------------------------------------------------------------ outcome


def _stage_lines(packet: FeedbackPacket) -> list[str]:
    counts: dict[str, int] = {}
    silent = 0
    for ep in packet.episodes:
        if ep.success:
            continue
        node = ep.abort.node if ep.abort is not None else None
        if ep.abort is None:
            # A graph cut off at the step limit did not finish; _budget_lines counts those.
            if ep.close_kind != "truncated":
                silent += 1
        else:
            key = node or "(no node named)"
            counts[key] = counts.get(key, 0) + 1
    lines: list[str] = []
    if counts:
        ranked = sorted(counts.items(), key=lambda kv: -kv[1])
        lines.append("Where the failed episodes' graphs raised: " + " · ".join(f"`{k}` ×{n}" for k, n in ranked) + ".")
    if silent:
        lines.append(
            f"**{silent} failed episode(s) raised nothing — your graph finished and the goal was not met.**"
        )
    if lines:
        lines.append("")
    return lines


def _budget_lines(packet: FeedbackPacket, arm: Condition) -> list[str]:
    truncated = [e for e in packet.episodes if e.close_kind == "truncated" and e.steps is not None]
    if not truncated:
        return []
    budget = max(e.steps or 0 for e in truncated)
    finished = [e.steps for e in packet.episodes if e.success and e.steps is not None]
    line = f"**{len(truncated)} of {len(packet.episodes)} episodes exhausted ~{budget} control steps with the task unfinished.**"
    if finished:
        line += f" Successful episodes used {min(finished)}–{max(finished)} steps."
    out = [line]
    if arm.state and arm.granularity != "episode":
        spans = [s for e in packet.episodes for s in e.motion_spans]
        if spans:
            moved = sum(max(0, s.end_step - s.start_step) for s in spans)
            out.append(
                f"Across the batch: {len(spans) / max(1, len(packet.episodes)):.0f} motion calls per episode, "
                f"{moved // max(1, len(packet.episodes))} steps spent inside them."
            )
    return out + [""]


def _abort_lines(packet: FeedbackPacket) -> list[str]:
    agg = packet.aggregate
    if not agg.aborted:
        return []
    where = " · ".join(f"`{name}` ×{count}" for name, count in agg.abort_nodes.items())
    head = f"**{agg.aborted} of {agg.n} episodes aborted: your graph raised instead of finishing"
    if agg.aborted_at_load == agg.aborted:
        head += ", every one at load, before any node ran"
    elif agg.aborted_at_load:
        head += f", {agg.aborted_at_load} of them at load"
    head += f".** Where: {where}."
    if agg.first_graph_error:
        head += f" Recorded error: `{agg.first_graph_error}`"
    return [head, "An aborted episode is scored as a failure. Fix the raising node first.", ""]


# ------------------------------------------------------------------ history


def _history(packet: FeedbackPacket, arm: Condition) -> list[str]:
    if not packet.history:
        return []
    lines = ["", "## What has been tried so far", "", "| iteration | train | edit | outcome |", "|---|---|---|---|"]
    for h in packet.history:
        train = (
            f"{h.train_success_rate * 100:.0f}%" + (f" of {h.train_n}" if h.train_n else "")
            if h.train_success_rate is not None else "—"
        )
        edit = ", ".join(
            f"{k.replace('_', ' ')} {v:+d}" for k, v in sorted(h.diff_stats.items()) if isinstance(v, int) and v
        ) or ("changed (not sized by any counter)" if h.changed else "no change")
        outcome = "applied" if h.accepted else "REJECTED by the check; policy unchanged"
        lines.append(f"| k={h.iteration} | {train} | {edit} | {outcome} |")
    behaviour: list[str] = []
    temporal = arm.granularity != "episode"
    for h in packet.history:
        frags: list[str] = []
        if h.failure_stages:
            top = [(k, n) for k, n in h.failure_stages.items() if k not in ("(claimed success)", "(out of steps)")][:3]
            if top:
                frags.append("graphs raised at " + " · ".join(f"`{k}` ×{n}" for k, n in top))
            if h.failure_stages.get("(out of steps)"):
                frags.append(f"{h.failure_stages['(out of steps)']} ran out of control steps without raising")
            if h.failure_stages.get("(claimed success)"):
                frags.append(f"{h.failure_stages['(claimed success)']} finished without raising and missed")
        if h.failure_errors:
            _node, message = next(iter(h.failure_errors.items()))
            frags.append(f'first recorded error: "{message}"')
        for name, row in (h.goal_outcomes or {}).items():
            bits: list[str] = []
            if arm.state and row.get("median_xy_end_m") is not None and _goal_numbers_allowed(name, arm):
                bits.append(f"median distance at the end {row['median_xy_end_m']:.3f} m")
            if arm.state and temporal and row.get("closest_m") is not None and _goal_numbers_allowed(name, arm):
                bits.append(f"closest {row['closest_m']:.3f} m")
            if arm.relations and temporal and row.get("reached_then_lost_n"):
                bits.append(f"reached the goal geometry and then lost it in {row['reached_then_lost_n']}/{row.get('failed_n', 0)}")
            if arm.relations:
                bits.append(f"held at the end {row.get('held_n', 0)}/{row.get('failed_n', 0)}")
            if bits:
                label = name if arm.level >= 2 else "→".join(_base(p) for p in name.split("→"))
                frags.append(f"goal {label}: " + ", ".join(bits))
        if arm.relations and temporal and h.grasp_summary:
            g = h.grasp_summary
            frag = f"grasp attempts {g.get('attempts', 0)}: met the object {g.get('on_object', 0)}, carried {g.get('carried', 0)}"
            if g.get("ejected"):
                frag += f", thrown out by the close {g['ejected']}"
            frags.append(frag)
        if arm.state and temporal and arm.level >= 2 and getattr(h, "attitude_peaks", None):
            frags.append("furthest turned: " + ", ".join(f"`{k}` {v:.0f}° from up" for k, v in sorted(h.attitude_peaks.items())))
        if frags:
            behaviour.append(f"- k={h.iteration}: " + "; ".join(frags) + ".")
    if behaviour:
        lines += ["", "What each past policy did (derived from its own recorded run):", "", *behaviour]
    last = packet.history[-1]
    if last.change:
        lines += [
            "", "The previous iteration described its own change as — its account, unverified:", "",
            "> " + last.change.strip().replace("\n", "\n> ")[:800], "",
        ]
    return lines + [""]


def _goal_numbers_allowed(label: str, arm: Condition) -> bool:
    """A goal's graded distance is object-level for containment, part-level otherwise.

    The digest keys goals as ``object→region``; a dotted side is a declared
    part, and its graded distance (one part to another) is a part fact.
    """
    return arm.level >= 2 or not any("." in side for side in label.split("→"))


# ------------------------------------------------------------------ units → markdown


def _unit_heading(unit: Unit, arm: Condition, index: int) -> str:
    if unit.kind == "episode":
        return "### Start → end of the episode"
    if unit.kind == "motion":
        span = unit.spans[0]
        head = f"### Motion {index + 1} · `{span.tool}` · arm {span.arm_id}"
        if arm.state and span.target_position:
            head += f" → toward {_xyz(span.target_position)}"
        head += f" · steps {span.start_step}–{span.end_step}"
        if span.status and span.status != "ok":
            head += f" · {span.status}"
        return head
    node = unit.node
    bits = [node.kind] if node and node.kind else []
    if node and node.status:
        bits.append(node.status)
    if node and node.duration_s:
        bits.append(f"{node.duration_s:.1f} s")
    return f"- **`{node.node if node else unit.key}`** ({', '.join(bits)})"


def _outputs(node: NodeTraceSummary | None, arm: Condition) -> str:
    """A node's own returned scalars -- the policy's outputs, at the condition's spatial level.

    The policy's values, not simulation feedback, so shown only with ``state``
    and cut to the spatial level: below ``frames`` nothing orientation-like
    (by key, or a quaternion-shaped value) survives.
    """
    if node is None or not node.detail or not arm.state:
        return ""
    keep: dict[str, Any] = {}
    for key, value in node.detail.items():
        text = str(value)
        if text.startswith("<ndarray") or text.startswith("<"):
            continue
        lowered = key.lower()
        orientation = any(t in lowered for t in ORIENTATION_WORDS) or ("w=" in text and "x=" in text)
        if arm.level == 0 and orientation:
            continue
        keep[key] = value
    return ", ".join(f"{k}={str(v)[:60]}" for k, v in keep.items())


@dataclass
class _Trail:
    """What the previous unit left standing, so each unit reports only changes."""

    facts: dict[str, str] = field(default_factory=dict)
    goals: dict[str, bool | None] = field(default_factory=dict)
    distances: dict[str, float] = field(default_factory=dict)


def _unit_lines(unit: Unit, arm: Condition, ep: EpisodeFeedback, frames: dict[str, list[UnitFrame]], trail: _Trail) -> list[str]:
    body: list[str] = []
    moved_entities, moved_hands = _moved_names(unit)
    if arm.state:
        body += _moves(unit, arm, ep)
        if unit.kind != "episode":
            body += _command(unit, arm)
            body += _grasp_state(unit, arm)
        if arm.level >= 1 and unit.after is not None and (moved_entities or moved_hands):
            body += _pose_lines(
                unit.after, arm, entities=moved_entities, hands=moved_hands,
                positions=False, turned_hands=_turned_hands(unit),
            )
    if arm.world:
        for goal in ep.goal_progress:
            label = _goal_label(goal)
            final = unit.kind == "episode"
            if arm.state:
                if final:
                    body += _goal_numbers(unit, arm, ep, goal, final=True)
                else:
                    reading = _goal_reading(unit, goal)
                    distance = (reading or {}).get("distance_m")
                    changed = distance is not None and abs(distance - trail.distances.get(label, 1e9)) >= 0.005
                    if changed or (arm.level <= 1 and moved_entities & {goal.subject or _base(goal.object_name)}):
                        body += _goal_numbers(unit, arm, ep, goal, final=False)
                    if distance is not None:
                        trail.distances[label] = distance
            if arm.relations:
                ok = goal.satisfied if final else (_goal_reading(unit, goal) or {}).get("ok")
                if ok is not None and (final or trail.goals.get(label) != ok):
                    sentence = _goal_predicate(goal, arm, ok, final=final)
                    if sentence:
                        body.append(sentence)
                if ok is not None:
                    trail.goals[label] = ok
    if arm.relations:
        body += _events(unit, arm, ep)
        if unit.kind == "episode":
            start, end = _relation_facts(unit.before, arm), _relation_facts(unit.after, arm)
            if start:
                body.append("at the start: " + "; ".join(start.values()) + ".")
            if end:
                body.append("at the end: " + "; ".join(end.values()) + ".")
        elif unit.after is not None:
            now = _relation_facts(unit.after, arm)
            body += _relation_changes(trail.facts, now)
            trail.facts = now
    if arm.world and unit.kind != "episode":
        for span in unit.spans:
            if span.error:
                body.append(f"`{span.tool}` ended with an error: {str(span.error).splitlines()[0][:200]}")
    if arm.visual:
        mine = frames.get(unit.key, [])
        if mine:
            body.append("stills: " + ", ".join(f"{f.when} ({f.camera}) `frames/{f.name}`" for f in mine))
    return body


def _episode_block(ep: EpisodeFeedback, arm: Condition) -> list[str]:
    suffix = ""
    if ep.steps is not None:
        suffix += f", {ep.steps} steps"
    if ep.close_kind:
        suffix += f", ended: {ep.close_kind}"
    lines = ["", f"## Episode {ep.episode_id} — {'SUCCESS' if ep.success else 'FAILURE'}{suffix}"]
    if ep.abort is not None:
        where = f"`{ep.abort.node}`" if ep.abort.node else "an unnamed node"
        stage = "at load, before any node ran" if ep.abort.at_load else f"at {where}"
        lines += ["", f"**Your graph raised {stage}: `{ep.abort.error}`**"]
        if ep.graph_traceback and not ep.abort.node:
            lines += ["", "```", ep.graph_traceback[-1500:], "```"]
    if not (arm.world or arm.visual):
        return lines
    frames: dict[str, list[UnitFrame]] = {}
    for frame in ep.unit_frames:
        frames.setdefault(frame.unit, []).append(frame)
    units = units_of(ep, arm.granularity)
    if not units:
        return lines
    trail = _Trail()
    start = slim_point(ep.point_start) if ep.point_start is not None else None
    if arm.world and arm.granularity != "episode" and start is not None:
        head: list[str] = []
        if arm.state:
            head += _pose_lines(start, arm)
        if arm.relations:
            trail.facts = _relation_facts(start, arm)
            head += [f"{sentence}." for sentence in trail.facts.values()]
        if head:
            lines += ["", "### At the start of the episode", *[f"- {line}" for line in head]]
    # Every unit's lines first, in order -- the change trail is sequential --
    # then the ones with something to say, capped around the failure.
    rendered: list[tuple[int, Unit, list[str]]] = []
    for index, unit in enumerate(units):
        body = _unit_lines(unit, arm, ep, frames, trail)
        if not arm.world and not body:
            continue  # a visual-only arm lists a unit only to label its stills
        if unit.kind != "node" and not body and not (unit.kind == "motion" and unit.failed):
            continue  # a unit with nothing to say is not listed
        if unit.kind == "node" and not body and not (arm.state and _outputs(unit.node, arm)) and not (unit.node and unit.node.error):
            continue
        rendered.append((index, unit, body))
    keep = _kept_units([u for _i, u, _b in rendered])
    lines.append("")
    current_subgraph = None
    omitted = 0
    for position, (index, unit, body) in enumerate(rendered):
        if position not in keep:
            omitted += 1
            continue
        if omitted:
            lines.append(f"(… {omitted} unit(s) with changes omitted …)")
            omitted = 0
        if unit.kind == "node":
            if unit.subgraph and unit.subgraph != current_subgraph:
                lines += ["", f"### `{unit.subgraph}`"]
                current_subgraph = unit.subgraph
            head_line = _unit_heading(unit, arm, index)
            outputs = _outputs(unit.node, arm)
            if outputs:
                head_line += f" — returned {outputs}"
            if unit.node and unit.node.error:
                head_line += f" — raised: {unit.node.error.splitlines()[0][:300]}"
            lines.append(head_line)
            lines += [f"  - {line}" for line in body]
            continue
        marker = "  **← your graph's error was raised during this motion**" if unit.failed and unit.kind == "motion" and ep.abort else ""
        lines.append(_unit_heading(unit, arm, index) + marker)
        lines += [f"- {line}" for line in body] or ["- (no change crossed the thresholds)"]
    if omitted:
        lines.append(f"(… {omitted} unit(s) with changes omitted …)")
    if arm.world and arm.granularity != "episode":
        end_point = slim_point(ep.point_end) if ep.point_end is not None else None
        end_unit = Unit(key="end", kind="episode", after=end_point)
        tail: list[str] = []
        if arm.state and end_point is not None:
            tail += _pose_lines(end_point, arm, entities=set(end_point.entities), hands=set())
            for goal in ep.goal_progress:
                tail += _goal_numbers(end_unit, arm, ep, goal, final=True)
        if arm.relations:
            tail += [f"{s}." for s in _relation_facts(end_point, arm).values()]
            for goal in ep.goal_progress:
                sentence = _goal_predicate(goal, arm, goal.satisfied, final=True)
                if sentence:
                    tail.append(sentence)
        if tail:
            lines += ["", "### At the end of the episode", *[f"- {line}" for line in tail]]
    return lines


def _vec(values) -> str:
    if isinstance(values, (int, float)):
        # A scalar where a vector was expected renders as the number.
        return f"{float(values):.4g}"
    return "[" + ", ".join(f"{float(v):.4g}" for v in values) + "]"


def narrate_features(declared: dict[str, dict[str, dict]]) -> list[str]:
    """One line per declared part: what it is (a ``loop``, a ``rod``, an ``axis``) and where, in its entity's frame."""
    out: list[str] = []
    for name, features in sorted(declared.items()):
        for feature, spec in sorted((features or {}).items()):
            kind = str(spec.get("kind", "?"))
            where = ""
            if isinstance(spec.get("center"), (list, tuple)):
                where = " at " + _vec(spec["center"])
            elif isinstance(spec.get("axis"), (list, tuple)) and spec["axis"]:
                ends = spec["axis"]
                if isinstance(ends[0], (list, tuple)):
                    where = f" from {_vec(ends[0])} to {_vec(ends[-1])}"
                else:
                    # A direction, not two end points: a cavity declares where
                    # it opens and which way it runs.
                    mouth = spec.get("mouth")
                    opens = f" opening at {_vec(mouth)}," if isinstance(mouth, (list, tuple)) else ""
                    where = f"{opens} running along {_vec(ends)}"
            extra = ", ".join(
                f"{key} {float(value):.4g}"
                for key, value in sorted(spec.items())
                if key not in ("kind", "center", "axis", "normal") and isinstance(value, (int, float))
            )
            out.append(
                f"`{name}.{feature}` — a {kind}{where}"
                f"{', ' + extra if extra else ''} (the entity's own frame, metres)"
            )
    return out


def _kept_units(units: list[Unit]) -> set[int]:
    if len(units) <= MAX_UNITS:
        return set(range(len(units)))
    focus = next((i for i, u in enumerate(units) if u.failed), len(units) - 1)
    keep = set(range(4)) | set(range(len(units) - 4, len(units)))
    half = (MAX_UNITS - 8) // 2
    keep |= set(range(max(0, focus - half), min(len(units), focus + half)))
    return keep


def _failure_signature(episode: EpisodeFeedback) -> tuple:
    """What makes two failures the same failure.

    The node the failure stopped at; ``close_kind``, which separates a policy
    that gave up from one that ran out of budget; and which goals were met.
    """
    satisfied = tuple(sorted(
        goal.object_name + "/" + goal.region_name
        for goal in episode.goal_progress
        if goal.satisfied
    ))
    return (episode.first_error_node(), episode.close_kind, satisfied)


def _failure_groups(failures: list[EpisodeFeedback]) -> list[tuple[tuple, list[EpisodeFeedback]]]:
    """Failures bucketed by signature, largest bucket first, so the episode
    rendered in full is from the most common way the batch failed."""
    groups: dict[tuple, list[EpisodeFeedback]] = {}
    for episode in failures:
        groups.setdefault(_failure_signature(episode), []).append(episode)
    return sorted(groups.items(), key=lambda kv: -len(kv[1]))


def representatives(packet: FeedbackPacket, *, budget: int, compress: bool) -> tuple[list[EpisodeFeedback], list[tuple[tuple, list[EpisodeFeedback]]]]:
    """The episodes rendered in full: one per failure signature (largest first), then a success."""
    failures = [e for e in packet.episodes if not e.success]
    passes = [e for e in packet.episodes if e.success]
    if compress and len(packet.episodes) > 1:
        groups = _failure_groups(failures)
        verbose = [members[0] for _sig, members in groups[:budget]]
    else:
        groups = []
        verbose = failures[:budget]
    if passes and len(verbose) < budget:
        verbose.append(passes[0])
    return verbose, groups


def design_markdown(packet: FeedbackPacket, *, max_episodes: int = 6, compress: bool = True) -> str:
    """FEEDBACK.md for a condition's view of a packet (:func:`view`).

    *max_episodes* episodes are rendered in full: one per distinct way the
    batch failed (largest group first), then one success. With *compress*,
    the other members of each failure group are listed in a short table.
    """
    arm = Condition.of(packet.design or {})
    agg = packet.aggregate
    lines = [
        f"# Execution feedback — iteration {packet.iteration}",
        "",
        f"Task: `{packet.task}/{packet.variant}` — {packet.instruction}",
        "",
        f"What this feedback contains: {arm.legend()}.",
        "",
        f"**Train result: {agg.successes}/{agg.n} episodes succeeded ({agg.success_rate * 100:.0f}%).**",
        "",
    ]
    lines += _history(packet, arm)
    if agg.abort or (agg.episodes_requested and agg.n < agg.episodes_requested):
        note = agg.abort or f"only {agg.n} of {agg.episodes_requested} requested episodes produced a scored row."
        lines += [f"**SHORT BATCH — {note}**", ""]
    if arm.world:
        conventions = ["Positions are world coordinates in metres [x, y, z]."]
        if arm.level >= 1:
            conventions.append(
                "Orientations are given as axis directions in world coordinates; an offset marked "
                "'its own axes' is along the object's own box axes (long/mid/short)."
            )
        if arm.level >= 2:
            conventions.append("Parts are declared by each asset in its own frame (below).")
        lines += [" ".join(conventions), ""]
    if arm.world and arm.level >= 2 and packet.declared_features:
        if arm.state:
            parts = narrate_features(packet.declared_features)
        else:
            # Names and kinds only: the geometry is numbers, and numbers are state.
            parts = [
                f"`{name}.{feature}` — a {spec.get('kind', 'part')}"
                for name, features in sorted(packet.declared_features.items())
                for feature, spec in sorted(features.items())
            ]
        if parts:
            lines += ["Declared parts — the vocabulary the goal is written and scored in:", *[f"- {p}" for p in parts], ""]
    headers = ["episode", "success", "steps", "ended"]
    lines += ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for ep in packet.episodes:
        ended = ep.close_kind or "—"
        if ep.abort is not None:
            ended += f" (graph raised at `{ep.abort.node}`)" if ep.abort.node else " (graph raised)"
        lines.append(
            f"| {ep.episode_id} | {'YES' if ep.success else 'no'} | "
            f"{ep.steps if ep.steps is not None else '—'} | {ended} |"
        )
    lines.append("")
    lines += _abort_lines(packet)
    lines += _budget_lines(packet, arm)
    lines += _stage_lines(packet)
    verbose, groups = representatives(packet, budget=max(1, int(max_episodes)), compress=compress)
    for ep in verbose:
        lines += _episode_block(ep, arm)
        members = next((m for _s, m in groups if m and m[0] is ep), [])
        if len(members) > 1:
            lines += ["", f"The other {len(members) - 1} episode(s) that failed this way:"]
            lines += ["| episode | steps | ended |", "|---|---|---|"]
            for other in members[1:]:
                lines.append(f"| {other.episode_id} | {other.steps} | {other.close_kind} |")
    remaining = [e for e in packet.episodes if not e.success and e not in verbose]
    if remaining and not groups:
        lines.append(f"\n({len(remaining)} more failed episodes are represented in the table.)")
    return "\n".join(lines)
