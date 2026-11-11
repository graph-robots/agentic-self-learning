# SPDX-License-Identifier: Apache-2.0
"""Goal families: how one evaluator metric shape becomes graded progress.

Goals are read from the evaluator's own metric keys and never from a task
name. **One family = one metric shape**, owning its parsing, its derivation
into :class:`~asl.feedback.schema.GoalProgress` rows, and (optionally) a
per-step tracker. A task whose evaluator speaks a new shape needs one more
:class:`GoalFamily` here and nothing else; no family may inspect anything but
metric keys and the capture.

Families must not overlap: each claims the keys it recognises, and a key
nobody claims simply renders verbatim in ``evaluator_metrics`` as before —
absence of a family is legible, not an error.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

from .schema import GoalProgress

if TYPE_CHECKING:  # pragma: no cover — typing only
    from .capture import RawPoint
    from .facts import FactExtractor
    from .schema import PointFacts

__all__ = ["GOAL_FAMILIES", "GoalFamily", "derive_goal_progress"]


@dataclass(frozen=True)
class GoalFamily:
    """One metric shape's whole treatment.

    ``parse`` reads the episode's metric dict and returns the family's goal
    specs (opaque to everyone else). ``derive`` turns those specs into
    :class:`GoalProgress` rows, given the episode's endpoint facts and the raw
    end record — geometry comes from there, never from a re-simulation.
    """

    name: str
    parse: Callable[[dict[str, Any]], list[Any]]
    derive: Callable[..., list[GoalProgress]]
    track: Callable[..., Any] | None = None
    """Optional: ``track(goal, manifest, body_q_tape) -> (distance[T], ok[T] | None)``
    — the family's own distance-to-goal and geometric verdict at **every**
    recorded step of the point tape. What makes ``closest_approach_m`` a fact
    about the episode rather than about its span boundaries: an object that
    reached its goal mid-episode and fell away on release would otherwise read
    as never having come close, because only span ends were sampled."""


# --------------------------------------------------------------- containment


def _parse_containment(metrics: dict[str, Any]) -> list[tuple[str, str, bool | None]]:
    """``containment/<object>/<region>`` → ``(object, region, satisfied)``."""
    out: list[tuple[str, str, bool | None]] = []
    for key, value in (metrics or {}).items():
        if not isinstance(key, str) or not key.startswith("containment/"):
            continue
        parts = key[len("containment/"):].split("/")
        if len(parts) != 2 or not all(parts):
            continue
        out.append((parts[0], parts[1], bool(value) if isinstance(value, (bool, int)) else None))
    return sorted(out)


def _derive_containment(
    extractor: FactExtractor,
    goals: list[tuple[str, str, bool | None]],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
    metrics: dict[str, Any],
) -> list[GoalProgress]:
    del metrics  # the parse already took what this family needs
    rows = extractor.goal_progress(goals, before, after, end_point)
    for row in rows:
        row.family = "containment"
    return rows


CONTAINMENT = GoalFamily(
    name="containment",
    parse=_parse_containment,
    derive=_derive_containment,
)


# --------------------------------------------------------------- enclosure
#
# A loop-around-a-rod metric shape: a flat verdict key ``encloses/<a>/<b>``
# names the two parts (the enclosing loop ``<a>`` and the enclosed rod
# ``<b>``, each ``<body>.<feature>``), and a positional ``goal.*`` group
# grades it — ``goal.<path>.<k>.offset`` (distance from the goal axis, m),
# ``.clearance`` (signed admissible margin, ≥ 0 iff enclosed), ``.encloses``
# (the same verdict), with sibling criteria ``.force`` (companion contact
# force, N) and ``.speed`` (companion rest clause). Both spellings come from
# one walk of the evaluator's goal tree, so graded groups and flat pair keys
# zip in emission order; when the counts disagree nothing is guessed — flat
# pairs render ungraded and graded groups render under their positional path.
#
# Field mapping into :class:`GoalProgress` (documented reuse, nothing else
# consumes the reused slots — the renderer dispatches on ``family`` and the
# behaviour digest reads only ``xy_distance_end_m``/``z_offset_end_m``):
#
# - ``object_name``  ← the enclosing part ``<a>`` (e.g. ``mug_1.handle``)
# - ``region_name``  ← the enclosed part ``<b>`` (e.g. ``rack_1.peg``)
# - ``satisfied``    ← the goal group's own bool (the conjunction the
#                      evaluator scores), else the enclosure verdict
# - ``xy_distance_end_m`` ← ``offset`` — the graded distance-to-goal, so the
#                      digest's "median xy end" stays honest for this family
# - ``xy_distance_start_m`` ← ``force`` in newtons; ``None`` when the group
#                      grades no force. The other optional distance slot is
#                      the one field that can say "ungraded".
# - ``fraction_end`` ← 1.0 when the enclosure verdict itself is true, 0.0
#                      when it is not — the fraction of the goal geometry
#                      realized, kept separately from ``satisfied`` because
#                      the group can fail on force or rest with the loop
#                      already around its rod.
# - ``z_offset_end_m`` ← left ``None`` deliberately. ``clearance`` is parsed
#                      (it backfills the enclosure verdict as ``clearance >= 0``
#                      when the bool is absent) but not stored: it is
#                      ``offset`` minus the pair's constant slack, and the
#                      digest would caption it "ABOVE/BELOW the window".
# - ``held_at_end`` / ``at_rest_end`` ← capture endpoint facts for the loop
#                      part's base body; rest falls back to the group's own
#                      speed clause when the capture does not know the body.


def _num_aware(segments: list[str]) -> list[tuple[int, object]]:
    """Sort key that orders ``goal.0.2`` after ``goal.0.1`` numerically."""
    return [(0, int(s)) if s.isdigit() else (1, s) for s in segments]


def _parse_loop_rod(metrics: dict[str, Any], atom: str) -> list[dict[str, Any]]:
    """``<atom>/<a>/<b>`` + the ``goal.*`` groups that grade them → specs.

    One parser for both rod-through-loop atoms, ``encloses`` and
    ``threaded``: the metric shape is identical bar the atom's name and, for
    ``threaded``, a ``crossings`` bool. The spec's verdict key stays
    ``encloses`` for both — it means "this atom's own verdict" — so the two
    families share one derivation of the parts nothing about them changes.
    """
    metrics = metrics or {}
    flat = atom + "/"
    pairs: list[tuple[str, str, bool | None]] = []
    for key, value in metrics.items():
        if not isinstance(key, str) or not key.startswith(flat):
            continue
        parts = key[len(flat):].split("/")
        if len(parts) != 2 or not all(parts):
            continue
        pairs.append((parts[0], parts[1], bool(value) if isinstance(value, (bool, int)) else None))

    groups: dict[tuple[str, ...], dict[str, Any]] = {}
    for key in metrics:
        if not isinstance(key, str) or "." not in key:
            continue
        segments = key.split(".")
        if segments[-1] != atom or len(segments) < 2:
            continue
        criterion = segments[:-1]
        group = tuple(criterion[:-1]) if criterion[-1].isdigit() and len(criterion) > 1 else tuple(criterion)
        prefix = ".".join(criterion)
        spec: dict[str, Any] = {
            "encloses": metrics.get(prefix + "." + atom),
            "offset_m": metrics.get(prefix + ".offset"),
            "clearance_m": metrics.get(prefix + ".clearance"),
            "crossings": metrics.get(prefix + ".crossings"),
            "group_ok": metrics.get(".".join(group)),
            "at": metrics.get(prefix + ".at"),
            "force_n": None,
            "rest": None,
        }
        for other, value in metrics.items():
            if not isinstance(other, str):
                continue
            osegs = other.split(".")
            if len(osegs) != len(group) + 2 or tuple(osegs[: len(group)]) != group:
                continue
            if osegs[-1] == "force" and spec["force_n"] is None and isinstance(value, (int, float)):
                spec["force_n"] = float(value)
            if osegs[-1] == "speed":
                rest = metrics.get(".".join(osegs[:-1]))
                if isinstance(rest, bool):
                    spec["rest"] = rest
        if spec["encloses"] is None and spec["clearance_m"] is not None:
            spec["encloses"] = bool(spec["clearance_m"] >= 0.0)
        groups[group] = spec

    ordered = []
    for group_path in sorted(groups, key=lambda g: _num_aware(list(g))):
        groups[group_path]["group_path"] = ".".join(group_path)
        ordered.append(groups[group_path])

    out: list[dict[str, Any]] = []
    if pairs and len(pairs) == len(ordered):
        # One goal-tree walk emitted both spellings, in order; zip is the join.
        for (loop, rod, flat_ok), spec in zip(pairs, ordered, strict=False):
            spec = dict(spec)
            spec["loop"], spec["rod"] = loop, rod
            if spec["encloses"] is None:
                spec["encloses"] = flat_ok
            out.append(spec)
    else:
        for spec in ordered:
            spec = dict(spec)
            spec["loop"], spec["rod"] = spec["group_path"], ""
            out.append(spec)
        for loop, rod, flat_ok in sorted(pairs):
            out.append({
                "loop": loop, "rod": rod, "encloses": flat_ok, "group_ok": flat_ok,
                "offset_m": None, "clearance_m": None, "crossings": None, "force_n": None, "rest": None,
                "at": None,
            })
    return out


def _parse_enclosure(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """``encloses/<a>/<b>`` + the ``goal.*`` groups that grade them → specs."""
    return _parse_loop_rod(metrics, "encloses")


def _parse_threaded(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """``threaded/<loop>/<rod>`` + the ``goal.*`` groups that grade them → specs."""
    return _parse_loop_rod(metrics, "threaded")


def _rot(q: list[float], v):
    """Rotate v by quaternion q (xyzw)."""
    import numpy as np
    x, y, z, w = q
    u = np.asarray([x, y, z], dtype=np.float64)
    vv = np.asarray(v, dtype=np.float64)
    return vv + 2.0 * np.cross(u, np.cross(u, vv) + w * vv)


def _loop_rod_world(after: PointFacts, manifest: dict, loop_ref: str, rod_ref: str) -> dict | None:
    """World geometry of a declared loop and rod at the episode's end.

    ``center``/``normal``/``inner_r`` for the loop, ``a``/``b`` (the rod's
    declared axis endpoints, in declaration order) and ``radius`` for the rod
    — placed by each body's live pose, or its static transform when the part
    is welded scenery. ``None`` when either side lacks a declared feature or a
    pose. Pure measurement over the manifest and the capture; no task named.
    """
    import numpy as np
    try:
        loop_base, loop_feat = loop_ref.split(".", 1)
        rod_base, rod_feat = rod_ref.split(".", 1)
    except ValueError:
        return None
    ents = manifest.get("entities") or {}
    lf = ((ents.get(loop_base) or {}).get("features") or {}).get(loop_feat)
    rf = ((ents.get(rod_base) or {}).get("features") or {}).get(rod_feat)
    le = after.entities.get(loop_base)
    re_ = after.entities.get(rod_base)
    if not lf or not rf or le is None or re_ is None:
        return None
    if len(le.pose_xyzw) < 7 or len(re_.pose_xyzw) < 7:
        return None
    if "center" not in lf or "axis" not in rf:
        return None
    lp = np.asarray(le.pose_xyzw, dtype=np.float64)
    rp = np.asarray(re_.pose_xyzw, dtype=np.float64)
    normal = _rot(list(lp[3:7]), lf["normal"]) if isinstance(lf.get("normal"), (list, tuple)) else None
    return {
        "center": lp[:3] + _rot(list(lp[3:7]), lf["center"]),
        "normal": normal,
        "inner_r": float(lf.get("inner_r", 0.0) or 0.0),
        "a": rp[:3] + _rot(list(rp[3:7]), rf["axis"][0]),
        "b": rp[:3] + _rot(list(rp[3:7]), rf["axis"][1]),
        "radius": float(rf.get("radius", 0.0) or 0.0),
    }


def _segment_distance(point, a, b) -> float:
    """Distance from a point to a finite segment — the measure ``encloses`` grades."""
    import numpy as np
    d = b - a
    span = float(d @ d)
    t = float(np.clip(((point - a) @ d) / span, 0.0, 1.0)) if span > 1e-18 else 0.0
    return float(np.linalg.norm(point - (a + t * d)))


def _feature_decomposition(after: PointFacts, manifest: dict, loop_ref: str, rod_ref: str):
    """[along-axis, vertical, lateral] offset of the loop centre from the rod
    tip, plus the loop-normal vs rod-axis tilt — (None, None) when either side
    lacks a declared feature or a live pose. Pure measurement over the
    manifest's feature payloads and the capture's poses; no task is named."""
    import numpy as np
    geo = _loop_rod_world(after, manifest, loop_ref, rod_ref)
    if geo is None:
        return None, None
    tip, base = geo["a"], geo["b"]
    axis = tip - base
    norm = float(np.linalg.norm(axis))
    if norm < 1e-9:
        return None, None
    axis = axis / norm
    delta = geo["center"] - tip
    along = float(delta @ axis)
    up = np.asarray([0.0, 0.0, 1.0]) - float(axis[2]) * axis
    un = float(np.linalg.norm(up))
    upn = up / un if un > 1e-9 else np.asarray([0.0, 0.0, 1.0])
    vertical = float(delta @ upn)
    lateral = float(np.linalg.norm(delta - along * axis - vertical * upn))
    tilt = None
    if geo["normal"] is not None:
        n_world = geo["normal"]
        c = abs(float(np.dot(n_world / max(float(np.linalg.norm(n_world)), 1e-12), axis)))
        tilt = float(np.degrees(np.arccos(min(1.0, max(-1.0, c)))))
    return [round(along, 4), round(vertical, 4), round(lateral, 4)], (round(tilt, 1) if tilt is not None else None)


def _threaded_decomposition(after: PointFacts, manifest: dict, loop_ref: str, rod_ref: str) -> dict | None:
    """The rod seen from the LOOP's side, for a goal that posts a rod through
    a fixed hole: the rod's nearer end relative to the loop's centre as
    ``tip_offset`` = [along the loop's normal (signed), in-plane lateral],
    the rod-axis-vs-normal ``tilt`` [deg, 0 = aligned to pass through], the
    loop's world ``center``, and ``distance`` from that centre to the nearest
    point of the rod segment — a bounded distance, unlike the evaluator's
    axis–plane crossing ``offset``."""
    import numpy as np
    geo = _loop_rod_world(after, manifest, loop_ref, rod_ref)
    if geo is None:
        return None
    center, a, b = geo["center"], geo["a"], geo["b"]
    near = a if float(np.linalg.norm(a - center)) <= float(np.linalg.norm(b - center)) else b
    out: dict[str, Any] = {
        "center": [round(float(v), 4) for v in center],
        "distance": round(_segment_distance(center, a, b), 4),
        "tip_offset": [],
        "tilt": None,
    }
    axis = b - a
    an = float(np.linalg.norm(axis))
    if geo["normal"] is not None and an > 1e-9:
        n = geo["normal"] / max(float(np.linalg.norm(geo["normal"])), 1e-12)
        delta = near - center
        along = float(delta @ n)
        lateral = float(np.linalg.norm(delta - along * n))
        out["tip_offset"] = [round(along, 4), round(lateral, 4)]
        c = abs(float(np.dot(axis / an, n)))
        out["tilt"] = round(float(np.degrees(np.arccos(min(1.0, max(-1.0, c))))), 1)
    return out


# ------------------------------------------------ per-step geometry (tapes)


def _pose_tape(manifest: dict, name: str, body_q):
    """One entity's pose at every recorded step, ``(T, 7)`` — live rows for a
    body, the static transform broadcast for welded scenery; ``None`` when the
    manifest knows neither."""
    import numpy as np
    record = (manifest.get("entities") or {}).get(name) or {}
    body = int(record.get("body", -1))
    if 0 <= body < body_q.shape[1]:
        return np.asarray(body_q[:, body, :7], dtype=np.float64)
    xform = np.asarray(record.get("xform_xyzw", ()), dtype=np.float64)
    if xform.size < 7:
        return None
    return np.broadcast_to(xform[:7], (body_q.shape[0], 7)).copy()


def _rot_tape(q, v):
    """Rotate one local vector by a ``(T, 4)`` column of xyzw quaternions → ``(T, 3)``."""
    import numpy as np
    u = np.asarray(q[:, :3], dtype=np.float64)
    w = np.asarray(q[:, 3:4], dtype=np.float64)
    vv = np.broadcast_to(np.asarray(v, dtype=np.float64), u.shape)
    return vv + 2.0 * np.cross(u, np.cross(u, vv) + w * vv)


def _segment_distance_tape(point, a, b):
    """Per-step distance from a point track to a segment track, all ``(T, 3)``."""
    import numpy as np
    d = b - a
    span = np.einsum("ij,ij->i", d, d)
    t = np.clip(np.einsum("ij,ij->i", point - a, d) / np.maximum(span, 1e-18), 0.0, 1.0)
    return np.linalg.norm(point - (a + t[:, None] * d), axis=1)


def _loop_rod_tape(goal: GoalProgress, manifest: dict, body_q) -> dict | None:
    """The loop/rod pair of a graded goal, tracked over the whole point tape."""
    try:
        loop_base, loop_feat = goal.object_name.split(".", 1)
        rod_base, rod_feat = goal.region_name.split(".", 1)
    except ValueError:
        return None
    ents = manifest.get("entities") or {}
    lf = ((ents.get(loop_base) or {}).get("features") or {}).get(loop_feat)
    rf = ((ents.get(rod_base) or {}).get("features") or {}).get(rod_feat)
    if not lf or not rf or "center" not in lf or "axis" not in rf:
        return None
    lp = _pose_tape(manifest, loop_base, body_q)
    rp = _pose_tape(manifest, rod_base, body_q)
    if lp is None or rp is None:
        return None
    return {
        "center": lp[:, :3] + _rot_tape(lp[:, 3:7], lf["center"]),
        "normal": _rot_tape(lp[:, 3:7], lf["normal"]) if isinstance(lf.get("normal"), (list, tuple)) else None,
        "inner_r": float(lf.get("inner_r", 0.0) or 0.0),
        "a": rp[:, :3] + _rot_tape(rp[:, 3:7], rf["axis"][0]),
        "b": rp[:, :3] + _rot_tape(rp[:, 3:7], rf["axis"][1]),
        "radius": float(rf.get("radius", 0.0) or 0.0),
    }


def _track_enclosure(goal: GoalProgress, manifest: dict, body_q):
    """``encloses`` at every step: loop centre to the rod segment, enclosed when
    that offset is within the loop's inner radius (the atom's own zero gate)."""
    geo = _loop_rod_tape(goal, manifest, body_q)
    if geo is None:
        return None
    dist = _segment_distance_tape(geo["center"], geo["a"], geo["b"])
    return dist, dist <= geo["inner_r"]


def _track_threaded(goal: GoalProgress, manifest: dict, body_q):
    """``threaded`` at every step: the same bounded loop-centre-to-segment
    distance for the hill, and the atom's own verdict — the axis crosses the
    loop's plane inside the segment and the rod's thickness fits — for
    whether the goal geometry was ever actually reached."""
    import numpy as np
    geo = _loop_rod_tape(goal, manifest, body_q)
    if geo is None:
        return None
    center, a, b = geo["center"], geo["a"], geo["b"]
    dist = _segment_distance_tape(center, a, b)
    if geo["normal"] is None:
        return dist, None
    n = geo["normal"] / np.maximum(np.linalg.norm(geo["normal"], axis=1, keepdims=True), 1e-12)
    d = b - a
    denom = np.einsum("ij,ij->i", d, n)
    parallel = np.abs(denom) <= 1e-12
    t = np.einsum("ij,ij->i", center - a, n) / np.where(parallel, 1.0, denom)
    hit = a + t[:, None] * d
    offset = np.linalg.norm(hit - center, axis=1)
    within = (~parallel) & (t >= -1e-9) & (t <= 1.0 + 1e-9)
    return dist, within & (offset + geo["radius"] <= geo["inner_r"])


def _track_containment(goal: GoalProgress, manifest: dict, body_q):
    """``containment`` at every step, for the object's centre: distance to the
    region's box (0 inside it) and whether the centre was inside."""
    import numpy as np

    from .facts import _region_bounds
    region = (manifest.get("regions") or {}).get(goal.region_name)
    pose = _pose_tape(manifest, goal.object_name, body_q) if region is not None else None
    if region is None or pose is None:
        return None
    frame_body = int(region.get("frame_body", -1))
    if 0 <= frame_body < body_q.shape[1]:
        bounds = [_region_bounds(region, body_q[t]) for t in range(body_q.shape[0])]
        lo = np.asarray([lo_ for lo_, _ in bounds])
        hi = np.asarray([hi_ for _, hi_ in bounds])
    else:
        lo_, hi_ = _region_bounds(region, body_q[0] if len(body_q) else np.zeros((0, 7)))
        lo = np.broadcast_to(lo_, (body_q.shape[0], 3))
        hi = np.broadcast_to(hi_, (body_q.shape[0], 3))
    p = pose[:, :3]
    outside = np.maximum(np.maximum(lo - p, 0.0), p - hi)
    dist = np.linalg.norm(outside, axis=1)
    return dist, dist <= 0.0


# Containment is declared above the tape toolkit; its tracker binds here.
CONTAINMENT = replace(CONTAINMENT, track=_track_containment)


def _derive_enclosure(
    extractor: FactExtractor,
    goals: list[dict[str, Any]],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
    metrics: dict[str, Any],
) -> list[GoalProgress]:
    """Map parsed enclosure specs into :class:`GoalProgress` rows.

    Field mapping (documented reuse; nothing generic consumes the reused
    slots — the renderer dispatches on ``family`` and the behaviour digest
    reads only the ``*_end_m`` fields):

    - ``object_name`` / ``region_name`` — the enclosing part ``<a>`` and the
      enclosed part ``<b>`` from ``encloses/<a>/<b>``.
    - ``satisfied`` — the goal group's own bool (the conjunction the
      evaluator scores), else the enclosure verdict.
    - ``xy_distance_end_m`` — the graded ``offset`` [m], a true
      distance-to-goal, so the digest's "median xy end" stays honest.
    - ``xy_distance_start_m`` — the companion contact ``force`` [N];
      ``None`` when the group grades no force. The other optional distance
      slot is the one field that can say "ungraded".
    - ``fraction_end`` — 1.0 when the enclosure verdict itself is true,
      0.0 otherwise: the fraction of the goal geometry realized, kept apart
      from ``satisfied`` because a group can fail on force or rest with the
      loop already around its rod.
    - ``z_offset_end_m`` — left ``None``: ``clearance`` is parsed (it
      backfills a missing verdict as ``clearance >= 0``) but never stored,
      being ``offset`` minus the pair's constant slack — and the digest
      would caption it "ABOVE/BELOW the window".
    - ``held_at_end`` / ``at_rest_end`` — capture endpoint facts for the
      loop part's base body; rest falls back to the group's speed clause.
    """
    del extractor, before, metrics  # graded numbers came with the parse; end_point keeps the manifest
    rows: list[GoalProgress] = []
    for spec in goals:
        base = str(spec.get("loop", "")).split(".")[0]
        entity = after.entities.get(base) if base else None
        satisfied = spec.get("group_ok")
        if not isinstance(satisfied, bool):
            satisfied = spec.get("encloses") if isinstance(spec.get("encloses"), bool) else None
        at_rest = entity.at_rest if entity is not None and entity.at_rest is not None else spec.get("rest")
        feature_offset, plane_tilt = _feature_decomposition(
            after, getattr(end_point, "manifest", None) or {}, str(spec.get("loop", "")), str(spec.get("rod", ""))
        )
        offset_m = float(spec["offset_m"]) if isinstance(spec.get("offset_m"), (int, float)) else None
        force_n = float(spec["force_n"]) if isinstance(spec.get("force_n"), (int, float)) else None
        # A diverged simulation renders NaN geometry; the number is dropped and
        # the flag kept, so NaN is never rendered as a distance (as in the
        # insertion family).
        nonfinite = any(v is not None and not math.isfinite(v) for v in (offset_m, force_n))
        if nonfinite:
            offset_m = force_n = None
        rows.append(
            GoalProgress(
                family="enclosure",
                object_name=str(spec.get("loop", "")),
                region_name=str(spec.get("rod", "")),
                subject=base,
                satisfied=satisfied,
                fraction_end=1.0 if spec.get("encloses") else 0.0,
                xy_distance_end_m=offset_m,
                xy_distance_start_m=force_n,
                held_at_end=any(arm.holding == base for arm in after.arms) if base else False,
                closed_around_at_end=False,
                readings_nonfinite=nonfinite,
                at_rest_end=at_rest,
                target_at=[float(v) for v in spec["at"]] if isinstance(spec.get("at"), (list, tuple)) and len(spec["at"]) == 3 else [],
                feature_offset_m=feature_offset or [],
                plane_tilt_deg=plane_tilt,
            )
        )
    return rows


ENCLOSURE = GoalFamily(
    name="enclosure",
    parse=_parse_enclosure,
    derive=_derive_enclosure,
    track=_track_enclosure,
)


# ---------------------------------------------------------------- insertion
#
# The connector-mate metric shape: flat verdict keys
# ``insertion/<part>/<bore>`` (with sibling gates spelled
# ``insertion:<variant>/<part>/<bore>`` — lat, tilt, mate_gap — and release
# clauses ``speed/<part>``, ``gripped/<part>.body``, ``tcp_distance/<part>``)
# beside positional ``goal.*`` groups carrying the atom's graded readings:
# ``goal.<path>.depth`` [m, tip past the mouth, negative outside],
# ``.lat`` [m, distance off the bore axis], ``.mate_gap`` [m, travel still to
# go to the bore floor], ``.tilt`` [rad, part axis vs bore axis]. Every goal
# clause gating the same atom repeats the same four readings under its own
# group, so groups are clustered by identical reading tuples: one cluster is
# one (part, bore) pair, and ``satisfied`` is the conjunction of the member
# groups' own verdict bools — the evaluator's own geometric clauses, never a
# guess about which ``:variant`` atoms gate and which merely observe (one
# task may gate tilt and only observe mate_gap, another the opposite).
#
# Field mapping into :class:`GoalProgress` (documented reuse — the renderer
# dispatches on ``family`` and the behaviour digest reads only the
# ``*_end_m`` fields):
#
# - ``object_name``  ← the inserted part (``plug``)
# - ``region_name``  ← the bore ref (``socket.bore``)
# - ``satisfied``    ← AND of the qualifying goal groups' own bools; with no
#                      groups, the flat base verdict alone (depth-only, the
#                      honest fallback)
# - ``xy_distance_end_m`` ← ``lat`` — a true transverse distance-to-goal, so
#                      the digest's "median xy end" stays honest
# - ``z_offset_end_m`` ← ``depth`` — where the tip ended along the insertion
#                      axis (positive past the mouth, negative outside), the
#                      digest's trend number for how deep failures got
# - ``xy_distance_start_m`` ← ``tilt`` in RADIANS; ``None`` when ungraded.
#                      The one slot that can say "ungraded".
# - ``fraction_end`` ← depth / (depth + mate_gap), clipped to [0, 1]: the
#                      fraction of the bore's full travel reached. A seated
#                      part can read well below 1 when it bottoms short of
#                      the bore floor — a trend number, not a success test;
#                      ``satisfied`` is the verdict.
# - ``held_at_end`` / ``at_rest_end`` ← capture endpoint facts for the part's
#                      base body; rest falls back to the ``speed/<part>``
#                      clause when the capture does not know the body.


def _parse_insertion(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """``insertion/<part>/<bore>`` + the ``goal.*`` groups that grade it."""
    metrics = metrics or {}
    pairs: list[dict[str, Any]] = []
    for key, value in metrics.items():
        if not isinstance(key, str) or not key.startswith("insertion/"):
            continue
        parts = key[len("insertion/"):].split("/")
        if len(parts) != 2 or not all(parts):
            continue
        pairs.append({
            "part": parts[0],
            "bore": parts[1],
            "flat_ok": bool(value) if isinstance(value, (bool, int)) else None,
        })

    readings = ("depth", "lat", "mate_gap", "tilt")
    groups: dict[tuple[str, ...], dict[str, Any]] = {}
    nonfinite = False
    for key, value in metrics.items():
        if not isinstance(key, str) or "." not in key:
            continue
        segments = key.split(".")
        if segments[-1] not in readings or len(segments) < 2:
            continue
        group = tuple(segments[:-1])
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)):
            # A diverged simulation renders NaN geometry. Keep the flag and
            # drop the number: NaN never clusters (NaN != NaN would split
            # every group into its own cluster) and must never be rendered
            # as a distance.
            nonfinite = True
            continue
        groups.setdefault(group, {})[segments[-1]] = float(value)

    clusters: dict[tuple, dict[str, Any]] = {}
    for group in sorted((g for g in groups if "depth" in groups[g]), key=lambda g: _num_aware(list(g))):
        values = groups[group]
        signature = tuple(round(values.get(r, float("nan")), 9) for r in readings)
        cluster = clusters.setdefault(signature, {**values, "verdicts": []})
        verdict = metrics.get(".".join(group))
        if isinstance(verdict, bool):
            cluster["verdicts"].append(verdict)

    ordered = list(clusters.values())
    out: list[dict[str, Any]] = []
    for index, pair in enumerate(pairs):
        spec = dict(pair)
        graded = ordered[index] if len(pairs) == len(ordered) else None
        if graded is not None:
            spec.update({r: graded.get(r) for r in readings})
            if graded["verdicts"]:
                spec["satisfied"] = all(graded["verdicts"])
        spec.setdefault("satisfied", spec["flat_ok"])
        spec["nonfinite"] = nonfinite and graded is None
        speed = metrics.get(f"speed/{pair['part']}")
        spec["speed_ok"] = bool(speed) if isinstance(speed, bool) else None
        out.append(spec)
    return out


def _derive_insertion(
    extractor: FactExtractor,
    goals: list[dict[str, Any]],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
    metrics: dict[str, Any],
) -> list[GoalProgress]:
    """Map parsed insertion specs into :class:`GoalProgress` rows.

    See the shape comment above for the field mapping; graded numbers came
    with the parse, and only the endpoint facts are read here.
    """
    del extractor, before, end_point, metrics
    rows: list[GoalProgress] = []
    for spec in goals:
        base = str(spec.get("part", "")).split(".")[0]
        entity = after.entities.get(base) if base else None
        depth, mate_gap = spec.get("depth"), spec.get("mate_gap")
        if depth is not None and mate_gap is not None and (depth + mate_gap) > 0.0:
            fraction = min(1.0, max(0.0, depth / (depth + mate_gap)))
        else:
            fraction = 1.0 if spec.get("satisfied") else 0.0
        at_rest = entity.at_rest if entity is not None and entity.at_rest is not None else spec.get("speed_ok")
        rows.append(
            GoalProgress(
                family="insertion",
                object_name=str(spec.get("part", "")),
                region_name=str(spec.get("bore", "")),
                satisfied=spec.get("satisfied"),
                fraction_end=fraction,
                xy_distance_end_m=(float(spec["lat"]) if isinstance(spec.get("lat"), (int, float)) else None),
                xy_distance_start_m=(
                    float(spec["tilt"]) if isinstance(spec.get("tilt"), (int, float)) else None
                ),
                z_offset_end_m=(float(depth) if isinstance(depth, (int, float)) else None),
                held_at_end=any(arm.holding == base for arm in after.arms) if base else False,
                at_rest_end=at_rest,
                readings_nonfinite=bool(spec.get("nonfinite")),
            )
        )
    return rows


INSERTION = GoalFamily(
    name="insertion",
    parse=_parse_insertion,
    derive=_derive_insertion,
)

# ----------------------------------------------------------------- fraction


_FRACTION_KEY = re.compile(r"^[A-Za-z0-9_]*[A-Za-z0-9]_fraction$")
_GOAL_VERDICT_KEY = re.compile(r"^goal\.(\d+)$")


def _parse_fraction(metrics: dict[str, Any]) -> list[tuple[str, float, bool | None]]:
    """``<subject>_fraction`` → ``(key, value, satisfied)``.

    The shape is a bare scalar metric whose key ends in ``_fraction`` — an
    evaluator publishing one is stating a proportion of the way to some
    all-or-nothing condition, and a threshold-gated goal over it
    (``(once (>= (broken-fraction film) t))``) writes exactly one anonymous
    verdict bit ``goal.N`` beside it. Keys containing ``/`` are another
    family's vocabulary (``containment/<object>/<region>``) and are left
    alone; boolean and non-finite values are not fractions and are skipped.

    The verdict pairing is by counting, because the metrics carry no link:
    with exactly one claimed fraction key and exactly one ``goal.N`` key, the
    verdict is that fraction's; any other count is ambiguous and ``satisfied``
    stays ``None`` rather than guessed. The aggregate ``goal`` bit is the
    episode's, not any one metric's, and is never read here.
    """
    fractions: list[tuple[str, float]] = []
    verdicts: list[bool] = []
    for key, value in (metrics or {}).items():
        if not isinstance(key, str):
            continue
        if _GOAL_VERDICT_KEY.fullmatch(key) and isinstance(value, (bool, int)):
            verdicts.append(bool(value))
            continue
        if not _FRACTION_KEY.fullmatch(key):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)):
            continue
        fractions.append((key, float(value)))
    fractions.sort()
    paired = verdicts[0] if len(fractions) == 1 and len(verdicts) == 1 else None
    return [(key, value, paired) for key, value in fractions]


def _derive_fraction(
    extractor: FactExtractor,
    goals: list[tuple[str, float, bool | None]],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
    metrics: dict[str, Any],
) -> list[GoalProgress]:
    """One row per claimed key. The mapping, field by field:

    - ``family`` — ``"fraction"``, the renderer's dispatch key.
    - ``object_name`` — the metric's subject, which for this shape is the
      metric key itself (``broken_fraction``): a bare scalar names what it
      measures and nothing else, so the row keeps the evaluator's own name
      and the reader can find the same number verbatim in
      ``evaluator_metrics``.
    - ``fraction_end`` — the scalar, unchanged. The grade *is* the metric;
      no capture geometry is consulted, which is why every geometry argument
      is ignored.
    - ``satisfied`` — the paired ``goal.N`` verdict, or ``None`` when the
      pairing was ambiguous.
    - ``region_name`` stays ``""`` and the geometry fields stay ``None``:
      there is no region and no distance in this shape, and writing a number
      into a typed field it does not mean would be the packet lying.

    The metrics here carry no threshold key, and :class:`GoalProgress` has no
    slot for one, so none is recorded — the feedback therefore never claims
    a threshold (the day an evaluator publishes one, ``<key>_threshold``
    is the natural shape and an optional field the natural home).

    Auxiliary same-shape scalars: an evaluator often publishes graded
    companions (a front position, a tension) next to its fraction. They are
    deliberately **not** folded into this row or its sentence — the family
    claims only keys the evaluator itself marked as fractions by suffix,
    and each claimed key gets its own row. A row that quoted its neighbours
    would blur which number the goal actually grades.
    """
    del extractor, before, after, end_point, metrics  # the scalar is the grade
    return [
        GoalProgress(
            family="fraction",
            object_name=key,
            satisfied=satisfied,
            fraction_end=value,
        )
        for key, value, satisfied in goals
    ]


FRACTION = GoalFamily(
    name="fraction",
    parse=_parse_fraction,
    derive=_derive_fraction,
)

# ---------------------------------------------------------------- threaded
#
# A rod-through-a-hole metric shape: ``threaded/<loop>/<rod>`` (a rod posted through a
# fixed hole — the loop is the welded fixture, the rod is the tool) with the
# same ``goal.*`` grading as enclosure plus ``.crossings``. It gets its own
# family rather than riding enclosure's because the honest readings differ:
# the evaluator's ``offset``/``at`` are where the rod's *axis line* crosses
# the loop's plane, unbounded for a rod lying flat, and the movable subject is
# the rod, not the loop.
# Field mapping as enclosure's, except:
#
# - ``subject``         ← the rod's body (what is held, carried, at rest)
# - ``xy_distance_end_m`` ← the loop centre's distance to the nearest point of
#                          the rod segment [m] — bounded, and the same measure
#                          the tape tracker climbs — never the crossing offset
# - ``tip_offset_m``    ← the rod's nearer end relative to the loop centre:
#                          [along the loop's normal (signed), in-plane lateral]
# - ``plane_tilt_deg``  ← rod axis vs loop normal (0 = aligned to pass through)
# - ``target_at`` / ``target_center`` ← the loop's own world centre, which no
#                          tool on the policy surface would otherwise reveal
#                          for a bodiless fixture


def _derive_threaded(
    extractor: FactExtractor,
    goals: list[dict[str, Any]],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
    metrics: dict[str, Any],
) -> list[GoalProgress]:
    del extractor, before, metrics
    manifest = getattr(end_point, "manifest", None) or {}
    rows: list[GoalProgress] = []
    for spec in goals:
        loop_ref, rod_ref = str(spec.get("loop", "")), str(spec.get("rod", ""))
        rod_base = rod_ref.split(".")[0] if rod_ref else ""
        entity = after.entities.get(rod_base) if rod_base else None
        satisfied = spec.get("group_ok")
        if not isinstance(satisfied, bool):
            satisfied = spec.get("encloses") if isinstance(spec.get("encloses"), bool) else None
        at_rest = entity.at_rest if entity is not None and entity.at_rest is not None else spec.get("rest")
        geo = _threaded_decomposition(after, manifest, loop_ref, rod_ref)
        offset_m = float(spec["offset_m"]) if isinstance(spec.get("offset_m"), (int, float)) else None
        force_n = float(spec["force_n"]) if isinstance(spec.get("force_n"), (int, float)) else None
        nonfinite = any(v is not None and not math.isfinite(v) for v in (offset_m, force_n))
        if nonfinite:
            offset_m = force_n = None
        if geo is not None:
            distance: float | None = geo["distance"]
        else:
            # Without declared geometry the only distance is the evaluator's
            # crossing offset, honest only when the axis actually crosses.
            distance = offset_m if spec.get("crossings") else None
        rows.append(
            GoalProgress(
                family="threaded",
                object_name=loop_ref,
                region_name=rod_ref,
                subject=rod_base,
                satisfied=satisfied,
                fraction_end=1.0 if spec.get("encloses") else 0.0,
                xy_distance_end_m=distance,
                xy_distance_start_m=force_n,
                held_at_end=any(arm.holding == rod_base for arm in after.arms) if rod_base else False,
                closed_around_at_end=False,
                readings_nonfinite=nonfinite,
                at_rest_end=at_rest,
                target_at=list(geo["center"]) if geo is not None else [],
                target_center=list(geo["center"]) if geo is not None else [],
                tip_offset_m=list(geo["tip_offset"]) if geo is not None else [],
                plane_tilt_deg=geo["tilt"] if geo is not None else None,
            )
        )
    return rows


THREADED = GoalFamily(
    name="threaded",
    parse=_parse_threaded,
    derive=_derive_threaded,
    track=_track_threaded,
)


GOAL_FAMILIES: tuple[GoalFamily, ...] = (CONTAINMENT, ENCLOSURE, INSERTION, FRACTION, THREADED)
"""Every metric shape the packet grades. Append families; never reorder —
row order in a packet follows family order, and diffs should stay quiet."""


def derive_goal_progress(
    extractor: FactExtractor,
    metrics: dict[str, Any],
    before: PointFacts,
    after: PointFacts,
    end_point: RawPoint,
) -> list[GoalProgress]:
    """Every family's graded rows for one episode, in family order."""
    rows: list[GoalProgress] = []
    for family in GOAL_FAMILIES:
        goals = family.parse(metrics)
        if goals:
            rows.extend(family.derive(extractor, goals, before, after, end_point, metrics))
    return rows


