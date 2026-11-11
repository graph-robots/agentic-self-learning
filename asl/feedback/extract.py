# SPDX-License-Identifier: Apache-2.0
"""Build a :class:`FeedbackPacket` from what RoboSimStudio's runner wrote for one batch.

Every source is optional except the result rows: a missing trace or a
malformed capture degrades the packet rather than losing the batch.

Sources, per episode id:
- ``episode_results.jsonl``: the outcome and the evaluator's metrics.
- ``<batch>/<ep>/capture_manifest.json`` + ``capture.npz`` + the marker files:
  every fact about the scene, per point and per motion span.
- ``<batch>/traces/<ep>/dag_trace.json`` + ``graph_result.json`` +
  ``node_data/``: the policy's own execution, node by node.
- ``<batch>/<ep>/cameras/*.mp4``: stills, for the ``visual`` form only.
"""

from __future__ import annotations

import json
import math
import re
import statistics
from pathlib import Path
from typing import Any

import numpy as np

from .capture import open_episode_capture
from .facts import FactExtractor
from .goals import GOAL_FAMILIES, derive_goal_progress
from .schema import (
    AbortFact,
    Aggregate,
    EpisodeFeedback,
    FeedbackPacket,
    IterationSummary,
    NodeTraceSummary,
)

__all__ = ["batch_abort_note", "behavior_digest", "build_packet"]


def _confirmed_carries(spans: list) -> set[str]:
    """Objects that at some point moved *with* a hand, not merely touched it.

    The per-point holding fact is two-sided finger contact, and a hand closed
    around an object resting on the table satisfies it while holding nothing.
    Carriage is the evidence contact cannot fake: over some motion span the
    object's path matches the hand's (within half of the larger), both long
    enough to mean motion, while a finger is in contact with it.
    """
    out: set[str] = set()
    for span in spans:
        ee = float(span.trajectory.ee_path_m or 0.0)
        if ee < 0.04:
            continue
        for name, path in (span.trajectory.entity_path_m or {}).items():
            if path < 0.04 or abs(path - ee) > 0.5 * max(path, ee):
                continue
            if any(
                "finger" in pair and f"entity:{name}" in pair
                for pair in span.trajectory.contact_pairs
            ):
                out.add(name)
    return out


def _goal_subject(goal) -> str:
    """The movable body a goal's hold/carry/contact facts are about."""
    return goal.subject or goal.object_name.split(".")[0]


def _node_at_step(spans: list, step: int) -> str:
    """The span containing *step*, or the one whose settle it fell in."""
    for span in spans:
        if span.start_step <= step <= span.end_step:
            return span.node or span.tool
    before = [span for span in spans if span.end_step <= step]
    if before:
        last = max(before, key=lambda span: span.end_step)
        return f"{last.node or last.tool} (after)"
    return ""


def _contacts_at(capture, extractor, step: int, base: str) -> list[str]:
    """What *base* was touching at one recorded step, by owner label."""
    if capture is None or extractor is None:
        return []
    try:
        point = capture.point(step=step)
    except (KeyError, ValueError, TypeError):
        return []
    try:
        contacts = extractor._contacts(point)
    except Exception:  # noqa: BLE001 -- a malformed contact row must not lose the fact
        return []
    mine = f"entity:{base}"
    partners: set[str] = set()
    for contact in contacts:
        for me, other in ((contact.owner_a, contact.owner_b), (contact.owner_b, contact.owner_a)):
            if me == mine and other and other != mine:
                partners.add(other[len("entity:"):] if other.startswith("entity:") else other)
    return sorted(partners)[:4]


def _closest_approaches(ep: EpisodeFeedback, capture=None, extractor=None) -> None:
    """Fill per-goal closest approach — over the whole point tape when it is there.

    Each graded family that can track its own geometry (``GoalFamily.track``)
    is asked for its distance-to-goal and verdict at **every recorded step**;
    the minimum, the step, the span it fell in, whether the goal geometry held
    at that instant, and what the object was touching then are all recorded.
    That last pair is what a span-end sample cannot give: a goal reached in
    the middle of a motion and lost on release.

    Without a tape (an archived packet, a capture without arrays) the earlier
    method stands: each motion span's end position for the goal object's base
    entity against the goal's own graded target point, centroid-corrected by
    the end-time difference between the graded and centroid end distances.
    ``closest_source`` says which was used.
    """
    families = {family.name: family for family in GOAL_FAMILIES}
    body_q = steps = manifest = None
    if capture is not None:
        arrays = getattr(capture, "arrays", None) or {}
        body_q = arrays.get("body_q")
        steps = arrays.get("step")
        manifest = getattr(capture, "manifest", None) or {}
    for goal in ep.goal_progress:
        family = families.get(goal.family)
        tracked = None
        if body_q is not None and family is not None and family.track is not None:
            try:
                tape = np.asarray(body_q, dtype=np.float64)
                if tape.ndim == 3 and len(tape):
                    tracked = family.track(goal, manifest, tape)
            except Exception as exc:  # noqa: BLE001 -- a tracker fault degrades to the span method
                print(f"[feedback] closest-approach tracker failed for {goal.object_name}: {type(exc).__name__}: {exc}")
                tracked = None
        if tracked is not None:
            dist, ok = tracked
            dist = np.asarray(dist, dtype=np.float64)
            finite = np.isfinite(dist)
            _span_goal_states(ep, goal, dist, ok, steps)
            if finite.any():
                index = int(np.argmin(np.where(finite, dist, np.inf)))
                step = int(steps[index]) if steps is not None and index < len(steps) else index
                goal.closest_approach_m = round(float(dist[index]), 4)
                goal.closest_step = step
                goal.closest_satisfied = bool(ok[index]) if ok is not None else None
                goal.closest_node = _node_at_step(ep.motion_spans, step)
                goal.closest_contacts = _contacts_at(capture, extractor, step, _goal_subject(goal))
                goal.closest_source = "tape"
                continue
        if len(goal.target_at) != 3:
            continue
        base = _goal_subject(goal)
        target = goal.target_at
        best: tuple[float, str] | None = None
        end_centroid: float | None = None
        for span in ep.motion_spans:
            entity = (span.delta.entities or {}).get(base) if span.delta else None
            pos = entity.after_position if entity is not None else None
            if not pos or len(pos) < 3:
                continue
            distance = float(sum((a - b) ** 2 for a, b in zip(pos[:3], target, strict=False)) ** 0.5)
            end_centroid = distance
            if best is None or distance < best[0]:
                best = (distance, span.node or span.tool)
        if best is None:
            continue
        correction = 0.0
        if goal.xy_distance_end_m is not None and end_centroid is not None:
            correction = goal.xy_distance_end_m - end_centroid
        goal.closest_approach_m = round(max(best[0] + correction, 0.0), 4)
        goal.closest_node = best[1]
        goal.closest_source = "span_ends"


def _span_goal_states(ep: EpisodeFeedback, goal, dist, ok, steps) -> None:
    """The family's own verdict and distance at each motion span's last step.

    The per-unit goal reading the ``motion`` and ``semantic`` granularities
    report ("after this motion the goal geometry held; after the next it did
    not"), read off the same per-step tracker as the closest approach.
    """
    if steps is None or not len(dist):
        return
    tape_steps = np.asarray(steps, dtype=np.int64)
    label = f"{goal.object_name}→{goal.region_name}"
    for span in ep.motion_spans:
        index = int(np.searchsorted(tape_steps, int(span.end_step), side="right")) - 1
        if index < 0 or index >= len(dist):
            continue
        value = float(dist[index])
        span.goal_states[label] = {
            "ok": (bool(ok[index]) if ok is not None else None),
            "distance_m": (round(value, 4) if math.isfinite(value) else None),
        }


def _attitude_tracks(ep: EpisodeFeedback, capture=None) -> None:
    """Fill per-declared-axis attitude over the whole point tape.

    For every non-static entity whose asset declares an ``axis`` feature, the
    axis's angle from world up at every recorded step: start, peak (with its
    step and the node that was running), end. Read off the tape because the
    endpoints cannot tell a body that was stood up and fell back from one that
    was never lifted, and a reward gated on the final attitude cannot either.
    """
    if capture is None:
        return
    arrays = getattr(capture, "arrays", None) or {}
    body_q = arrays.get("body_q")
    steps = arrays.get("step")
    manifest = getattr(capture, "manifest", None) or {}
    if body_q is None:
        return
    tape = np.asarray(body_q, dtype=np.float64)
    if tape.ndim != 3 or not len(tape):
        return
    for name, record in sorted((manifest.get("entities") or {}).items()):
        if bool(record.get("static", False)):
            continue
        body = int(record.get("body", -1))
        if not 0 <= body < tape.shape[1]:
            continue
        for feature, spec in sorted((record.get("features") or {}).items()):
            if not isinstance(spec, dict) or str(spec.get("kind", "")) != "axis":
                continue
            direction = np.asarray(spec.get("direction", ()), dtype=np.float64).reshape(-1)
            if direction.shape != (3,) or float(np.linalg.norm(direction)) < 1e-9:
                continue
            direction = direction / np.linalg.norm(direction)
            q = tape[:, body, 3:7]
            xyz, w = q[:, :3], q[:, 3:4]
            d = np.broadcast_to(direction, xyz.shape)
            world = d + 2.0 * np.cross(xyz, np.cross(xyz, d) + w * d)
            angle = np.degrees(np.arccos(np.clip(world[:, 2], -1.0, 1.0)))
            index = int(np.argmax(angle))
            step = int(steps[index]) if steps is not None and index < len(steps) else index
            ep.attitude_tracks[f"{name}.{feature}"] = {
                "start_deg": round(float(angle[0]), 1),
                "peak_deg": round(float(angle[index]), 1),
                "peak_step": step,
                "peak_node": _node_at_step(ep.motion_spans, step),
                "end_deg": round(float(angle[-1]), 1),
            }


def _settle_grasp_verdicts(ep: EpisodeFeedback) -> None:
    """Judge each close over the motion that follows it, not the close alone.

    A grasp on thin stock seats under load: the fingertips rest on the bench
    either side of a handle while the jaws are still closing, the close span
    ends, and the object is gripped as the hand rises. Judged at the close
    alone, such a grasp reads "the fingers met something other than the
    object" right above the carry that proves otherwise.

    The window is the same arm's spans after the close, up to its next
    release, open, or grasp attempt. The close is upgraded to ``object`` when
    a finger touched the object in a later span **and** that span carried it
    (path matching the hand's); a touch without a carry is recorded as a brush.
    """
    spans = ep.motion_spans
    arm_names = {arm.arm_id: arm.name for arm in (ep.point_end.arms if ep.point_end else [])}
    for index, span in enumerate(spans):
        grasp = span.grasp
        if grasp is None or not grasp.object_name or grasp.closed_on == "object":
            continue
        arm_label = arm_names.get(span.arm_id, "")
        for later in spans[index + 1:]:
            if later.arm_id != span.arm_id:
                continue
            verb = (later.tool or "").rsplit(".", 1)[-1].lower()
            if later.grasp is not None or "open" in verb or "release" in verb:
                break
            pairs = later.trajectory.contact_pairs
            touched = any(
                "finger" in pair
                and f"entity:{grasp.object_name}" in pair
                and (not arm_label or f"arm:{arm_label}" in pair)
                for pair in pairs
            )
            if not touched:
                continue
            if grasp.object_name in _confirmed_carries([later]):
                grasp.closed_on = "object"
                grasp.engaged_node = later.node or later.tool
                break
            if not grasp.touched_later_node:
                grasp.touched_later_node = later.node or later.tool


def _settle_close_displacement(ep: EpisodeFeedback, *, moved_threshold_m: float = 0.005) -> None:
    """Say what the part did WHILE the jaws shut, and whether the close threw it.

    A step-input close on a stiff finger servo can eject a thin part; the
    jaws then meet each other and the aperture reads 0 exactly as if the part
    had never been there, which reads as "the descent missed".

    Two numbers, both already recorded, put next to the verdict: how far the
    object moved during the close, and how far it had moved during the same
    arm's previous motion span. ``ejected`` is set when the close moved it
    past the extractor's threshold (or turned it > 0.2 rad) and no later span
    carried it. Facts only; the tool to reach for is the contract's business.
    """
    spans = ep.motion_spans
    for index, span in enumerate(spans):
        grasp = span.grasp
        if grasp is None or not grasp.object_name:
            continue
        name = grasp.object_name
        during = (span.delta.entities or {}).get(name) if span.delta is not None else None
        if during is not None:
            grasp.moved_during_close_m = round(float(during.displacement_m or 0.0), 4)
            grasp.rotated_during_close_rad = round(float(during.orientation_change_rad or 0.0), 3)
        for earlier in reversed(spans[:index]):
            if earlier.arm_id != span.arm_id:
                continue
            verb = (earlier.tool or "").rsplit(".", 1)[-1].lower()
            if earlier.grasp is not None or "open" in verb or "release" in verb:
                break
            before = (earlier.delta.entities or {}).get(name) if earlier.delta is not None else None
            if before is not None:
                grasp.moved_before_close_m = round(float(before.displacement_m or 0.0), 4)
                grasp.moved_before_close_node = earlier.node or earlier.tool
            break
        thrown = (
            (grasp.moved_during_close_m or 0.0) >= moved_threshold_m
            or abs(grasp.rotated_during_close_rad or 0.0) >= 0.2
        )
        if not thrown:
            continue
        window = []
        for later in spans[index + 1:]:
            if later.arm_id != span.arm_id:
                continue
            verb = (later.tool or "").rsplit(".", 1)[-1].lower()
            if later.grasp is not None or "open" in verb or "release" in verb:
                break
            window.append(later)
        carried = name in _confirmed_carries([span] + window)
        grasp.ejected = not carried and not grasp.engaged_node


def _loss_events(ep: EpisodeFeedback) -> None:
    """Name the span where a held object left the hand, and what it had touched.

    The chain is otherwise spread over contact events and a released
    transition; assembled into one line per loss, it is the difference
    between "ended 8 cm away, not held" and "left the hand during
    `place_sg.place` right after touching the table." Facts only: the
    transition and the contacts are both already recorded.
    """
    for span in ep.motion_spans:
        if span.delta is None:
            continue
        name = (span.node or span.tool or "").lower()
        if "release" in name or "open" in name:
            continue  # a deliberate letting-go is not a loss
        for arm in span.delta.arms:
            if not arm.released:
                continue
            partners = sorted(
                pair for pair in (span.delta.contacts_started or [])
                if arm.released in pair and "finger" not in pair
            )
            note = f"{arm.released} left arm {arm.arm_id}'s hand during `{span.node or span.tool}`"
            if partners:
                note += f" after new contact: {'; '.join(partners[:2])}"
            ep.loss_events.append(note)

def _confirm_holds(ep: EpisodeFeedback) -> None:
    """Downgrade contact-only "grasped/held" claims to what the run proves.

    ``held_at_end`` survives only for objects in the confirmed-carry set;
    otherwise it becomes ``closed_around_at_end`` and the narration says so.
    Span-level deltas get the same marking so the feedback never states the strong
    claim the episode never earned. Enclosure goals name features
    ("mug.handle"); paths are recorded per entity, so compare the base.
    """
    confirmed = _confirmed_carries(ep.motion_spans)
    deltas = [ep.state_delta] + [span.delta for span in ep.motion_spans]
    for delta in deltas:
        if delta is None:
            continue
        for arm in delta.arms:
            if arm.grasped and arm.grasped in confirmed:
                arm.hold_confirmed = True
    for goal in ep.goal_progress:
        if goal.held_at_end and _goal_subject(goal) not in confirmed:
            goal.held_at_end = False
            goal.closed_around_at_end = True


MAX_TRACEBACK_CHARS = 4000
"""The tail of a graph's traceback kept per episode."""


def batch_abort_note(n: int, requested: int) -> str | None:
    """One sentence when a batch wrote fewer scored rows than were asked for; ``None`` when complete.

    A rate over a silently shrunken batch reads as if every episode ran, so
    the feedback says the batch is short.
    """
    if requested <= 0 or n >= requested:
        return None
    never_ran = max(requested - n - 1, 0)
    return (
        f"the runner was asked for {requested} episodes and wrote {n} scored rows: "
        f"the episode after the last scored one died mid-run"
        + (f" and {never_ran} more never started" if never_ran else "")
        + f". Every rate over this batch counts {n} episodes, not {requested}."
    )


def build_packet(
    batch_dir: Path,
    rows: list[dict],
    *,
    iteration: int,
    task: str,
    instruction: str,
    requested: int = 0,
    history: list[IterationSummary] | None = None,
    feedback: Any = None,
) -> FeedbackPacket:
    """The full packet for one training batch: every fact for every episode.

    *batch_dir* is the runner's output for the batch (``episode_results.jsonl``,
    the per-episode capture directories and ``traces/``), *rows* its result
    rows, *task* ``suite/variant``. *feedback* is the run's feedback condition;
    only the ``visual`` form needs it here, to take stills.
    """
    batch_dir = Path(batch_dir)
    episodes = [_episode(row, batch_dir) for row in sorted(rows, key=lambda r: int(r.get("episode_id", 0)))]
    n = len(episodes)
    successes = sum(1 for ep in episodes if ep.success)
    lengths = [int(r.get("episode_length", 0)) for r in rows]
    close_kinds: dict[str, int] = {}
    for row in rows:
        kind = str(row.get("close_kind", "unknown"))
        close_kinds[kind] = close_kinds.get(kind, 0) + 1
    aborted = [ep for ep in episodes if ep.abort is not None]
    abort_nodes: dict[str, int] = {}
    for ep in aborted:
        key = ep.abort.node or "(no node named)"
        abort_nodes[key] = abort_nodes.get(key, 0) + 1
    abort_nodes = dict(sorted(abort_nodes.items(), key=lambda kv: -kv[1]))
    dominant = next(iter(abort_nodes), None)
    first_error = next(
        (ep.abort.error for ep in aborted if (ep.abort.node or "(no node named)") == dominant), None
    )
    aggregate = Aggregate(
        n=n,
        successes=successes,
        success_rate=round(successes / n if n else 0.0, 4),
        episodes_requested=requested,
        abort=batch_abort_note(n, requested),
        aborted=len(aborted),
        aborted_at_load=sum(1 for ep in aborted if ep.abort.at_load),
        truncated=sum(1 for ep in episodes if ep.close_kind == "truncated"),
        abort_nodes=abort_nodes,
        first_graph_error=first_error,
        median_steps=float(statistics.median(lengths)) if lengths else 0.0,
        close_kinds=close_kinds,
        per_episode_success={e.episode_id: e.success for e in episodes},
    )
    # The declared parts, once per packet: identical in every episode.
    declared: dict[str, dict[str, dict]] = {}
    for ep in episodes:
        point = ep.point_end or ep.point_start
        for name, fact in (getattr(point, "entities", {}) or {}).items():
            if fact.features and name not in declared:
                declared[name] = {str(k): dict(v) for k, v in fact.features.items()}
    suite, _, variant = str(task).partition("/")
    packet = FeedbackPacket(
        iteration=iteration,
        task=suite,
        variant=variant,
        instruction=instruction,
        aggregate=aggregate,
        episodes=episodes,
        history=list(history or []),
        declared_features=declared,
    )
    if feedback is not None and "visual" in (getattr(feedback, "form", None) or ()):
        # Stills at the condition's own unit boundaries, for the episodes the
        # feedback will render: chosen after every episode is built, because
        # which episodes those are depends on how all of them failed.
        from .frames import extract_unit_frames  # noqa: PLC0415

        try:
            extract_unit_frames(packet, batch_dir, feedback, budget_episodes=int(getattr(feedback, "max_episodes", 6)))
        except Exception as exc:  # noqa: BLE001 -- pictures must not take the packet down
            print(f"[feedback] could not extract unit stills: {type(exc).__name__}: {exc}")
    return packet


def _episode(row: dict, batch_dir: Path) -> EpisodeFeedback:
    episode_id = int(row.get("episode_id", 0))
    ep = EpisodeFeedback(
        episode_id=episode_id,
        seed=int(row.get("seed", 0)),
        success=bool(row.get("success", False)),
        steps=int(row.get("episode_length", 0)),
        reward=float(row.get("reward", 0.0)),
        close_kind=str(row.get("close_kind", "unknown")),
        evaluator_metrics=dict(row.get("metrics") or {}),
    )
    trace_dir = batch_dir / "traces" / f"{episode_id:04d}"

    # ---- raw capture -> structured facts -------------------------------------
    try:
        capture = open_episode_capture(batch_dir, episode_id, row)
        if capture is not None:
            positions, rotations = _planned_poses(trace_dir)
            extractor = FactExtractor(planned_targets=positions)
            extractor.planned_rotations = rotations
            end_record = capture.point(event="episode_end")
            start = extractor.point(capture.point(event="episode_start"))
            end = extractor.point(end_record)
            ep.point_start = start
            ep.point_end = end
            ep.state_delta = extractor.delta(start, end)
            ep.motion_spans = [extractor.span(span) for span in capture.iter_spans()]
            _settle_grasp_verdicts(ep)
            _settle_close_displacement(ep, moved_threshold_m=extractor.moved_threshold_m)
            ep.grasp_geometry = [span.grasp for span in ep.motion_spans if span.grasp is not None]
            # The goals come from the evaluator's own metric keys, the
            # geometry from the same capture the region fractions use.
            ep.goal_progress = derive_goal_progress(
                extractor, ep.evaluator_metrics, start, end, end_record
            )
            _confirm_holds(ep)
            _closest_approaches(ep, capture, extractor)
            _attitude_tracks(ep, capture)
            _loss_events(ep)
    except Exception as exc:  # noqa: BLE001 -- a malformed capture must not lose the outcome rows
        print(f"[feedback] could not derive capture facts for episode {episode_id}: {type(exc).__name__}: {exc}")

    # ---- the policy's own execution ------------------------------------------
    graph_result = _load_json(trace_dir / "graph_result.json")
    if graph_result:
        error = graph_result.get("graph_error")
        if error:
            ep.graph_error = str(error)[:MAX_TRACEBACK_CHARS]
        traceback_text = graph_result.get("graph_traceback")
        if traceback_text:
            ep.graph_traceback = str(traceback_text)[-MAX_TRACEBACK_CHARS:]
    trace = _load_json(trace_dir / "dag_trace.json")
    ep.nodes = _node_summaries(trace, trace_dir)
    _attribute_steps(ep)
    ep.abort = _abort_fact(ep, trace)
    return ep


_NODE_IN_ERROR = (
    re.compile(r"first node error -- ([A-Za-z0-9_.]+):"),
    re.compile(r"Node '([^']+)' failed"),
    re.compile(r"subgraph '([^']+)'"),
)


def _abort_fact(ep: EpisodeFeedback, trace: dict[str, Any] | None) -> AbortFact | None:
    """The outcome account of a graph that raised.

    Three sources for the node, in order of authority: the node table (a
    node with a recorded error), the ``error_recorded`` event stream (the
    table can lag it -- a node re-visited through a retry edge stayed
    ``running`` in the table of every trace written before the tracer reset
    it), and the error text itself (``first node error -- <node>:``, or the
    subgraph a load-time binding failure names). A missing trace beside a
    recorded graph error is the load-time abort: nothing ran.
    """
    if ep.success or not ep.graph_error:
        return None
    node = next((n.node for n in ep.nodes if n.error), None)
    message = next((n.error for n in ep.nodes if n.error), None)
    if node is None and trace:
        for event in trace.get("events") or []:
            if isinstance(event, dict) and event.get("event_type") == "error_recorded" and event.get("node_name"):
                node = str(event["node_name"])
                message = str((event.get("detail") or {}).get("error") or "") or None
                break
    if node is None:
        for pattern in _NODE_IN_ERROR:
            match = pattern.search(ep.graph_error)
            if match:
                node = match.group(1)
                break
    started = any(n.status not in ("", "pending") for n in ep.nodes)
    return AbortFact(
        node=node,
        error=str(message or ep.graph_error).splitlines()[0][:300],
        step=ep.steps,
        before_motion=not ep.motion_spans,
        at_load=not trace or not started,
    )


def behavior_digest(packet: FeedbackPacket) -> dict[str, Any]:
    """What one iteration's policy actually did, derived from its archived packet.

    The memory a past iteration leaves behind is facts the loop recorded,
    never a summary anyone wrote: a rationale can misdescribe the edit that
    mattered. Reads the full packet (``feedback.json``), which exists whatever
    the agent was shown, and returns the ``IterationSummary`` behaviour
    fields. Rendering is gated by the feedback condition, so a sparse
    condition's history stays sparse.
    """
    stages: dict[str, int] = {}
    errors: dict[str, str] = {}
    grasp = {"attempts": 0, "on_object": 0, "carried": 0, "ejected": 0}
    goal_rows: dict[str, dict[str, list]] = {}
    attitude_peaks: dict[str, float] = {}
    for ep in packet.episodes:
        for key, track in (ep.attitude_tracks or {}).items():
            peak = track.get("peak_deg")
            if peak is not None:
                attitude_peaks[key] = max(attitude_peaks.get(key, float("-inf")), float(peak))
        for attempt in ep.grasp_geometry:
            grasp["attempts"] += 1
            grasp["on_object"] += int(attempt.closed_on == "object")
            grasp["ejected"] += int(bool(attempt.ejected))
        for delta in [ep.state_delta] + [sp.delta for sp in ep.motion_spans]:
            if delta is None:
                continue
            grasp["carried"] += sum(1 for arm in delta.arms if arm.hold_confirmed)
        if ep.success:
            continue
        # A graph raised only where the outcome says it did: a node's error the
        # graph carried on past, or the one a node records when the step limit
        # cuts it off, is not where the episode failed.
        first = (ep.first_error_node() or "(graph error, no node blamed)") if ep.abort is not None else None
        key = first or ("(out of steps)" if ep.close_kind == "truncated" else "(claimed success)")
        stages[key] = stages.get(key, 0) + 1
        if first is not None and first not in errors:
            node = next((n for n in ep.nodes if n.node == first and n.error), None)
            message = node.error if node is not None else ep.graph_error
            if message:
                errors[first] = str(message).splitlines()[0][:200]
        for goal in ep.goal_progress:
            row = goal_rows.setdefault(
                f"{goal.object_name}→{goal.region_name}",
                {"xy": [], "z": [], "held": [], "rest": [], "closest": [], "reached": []},
            )
            if goal.closest_approach_m is not None:
                row["closest"].append(goal.closest_approach_m)
            row["reached"].append(bool(goal.closest_satisfied))
            if goal.xy_distance_end_m is not None:
                row["xy"].append(goal.xy_distance_end_m)
            if goal.z_offset_end_m is not None:
                row["z"].append(goal.z_offset_end_m)
            row["held"].append(bool(goal.held_at_end))
            row["rest"].append(bool(goal.at_rest_end))
    goal_outcomes = {
        name: {
            "failed_n": len(row["held"]),
            "median_xy_end_m": round(statistics.median(row["xy"]), 4) if row["xy"] else None,
            "closest_m": round(min(row["closest"]), 4) if row["closest"] else None,
            # The batch's typical approach beside its best one: the minimum
            # can be one lucky swing.
            "median_closest_m": round(statistics.median(row["closest"]), 4) if row["closest"] else None,
            "median_z_offset_end_m": round(statistics.median(row["z"]), 4) if row["z"] else None,
            "held_n": sum(row["held"]),
            "reached_then_lost_n": sum(row["reached"]),
        }
        for name, row in goal_rows.items()
    }
    aborted = sum(1 for ep in packet.episodes if ep.abort is not None)
    ranked_stages = dict(sorted(stages.items(), key=lambda kv: -kv[1]))
    dominant = next(iter(ranked_stages), None)
    return {
        "grasp_summary": grasp if grasp["attempts"] else {},
        "failure_stages": ranked_stages,
        "failure_errors": errors,
        "aborted": aborted,
        "dominant_error": f"{dominant}: {errors[dominant]}" if dominant in errors else "",
        "goal_outcomes": goal_outcomes,
        "attitude_peaks": {key: round(value, 1) for key, value in sorted(attitude_peaks.items())},
    }


def _attribute_steps(ep: EpisodeFeedback) -> None:
    """Say what each node cost in **control steps**, not just wall seconds.

    Episodes that run out of steps with the task half done need to know
    which node spent the budget. The trace records wall time per node, and
    the results row gives the episode's steps, so the rate converts one to
    the other.

    Approximate, and labelled so: the rate is an episode average, and a node
    that blocked on a mesh search spent wall time without spending steps.
    Good enough to say "the grasp subgraph took two thirds of the budget",
    which is the sentence that matters.
    """
    total_s = sum(n.duration_s for n in ep.nodes)
    if not ep.steps or total_s <= 0:
        return
    rate = ep.steps / total_s
    for node in ep.nodes:
        steps = int(round(node.duration_s * rate))
        if steps:
            node.detail["~steps"] = steps


MAX_DETAIL_KEYS = 12
"""Outputs surfaced per node. A cap, because a packet that reprints every
field stops being read — but not so tight that a node's geometry is squeezed
out by its bookkeeping: a node returning five poses emits ten dotted entries."""

MAX_VECTOR_LEN = 4
"""Longest numeric tuple rendered inline: a quaternion."""

MAX_DETAIL_CHARS = 80
"""Longest string value worth quoting in a per-node line."""


def _compact_vector(value: Any) -> str | None:
    """A short numeric tuple rendered inline, or ``None`` if it is not one.

    The workflow describes what was *asked for*; these are what came *back*.
    A constant returned where a variable was expected (the same axis on every
    episode, whatever the object's yaw) is visible at a glance once printed.
    """
    labels: list[str] = []
    if isinstance(value, dict):
        keys = [k for k in ("x", "y", "z", "w") if k in value]
        if not keys or len(keys) != len(value):
            return None
        items = [value[k] for k in keys]
        # Named, because a bare 4-tuple does not say whether it is wxyz or
        # xyzw and a quaternion read in the wrong order is a silent wrong turn.
        labels = keys
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        return None
    if not items or len(items) > MAX_VECTOR_LEN:
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in items):
        return None
    parts = [f"{float(v):.4g}" for v in items]
    if labels:
        # strict: labels are the same keys `items` was built from, so a
        # length mismatch is a bug here, not a shape to render around --
        # and silently truncating one would print a quaternion missing a
        # component, which reads as a real value.
        parts = [f"{k}={p}" for k, p in zip(labels, parts, strict=True)]
    return "(" + ", ".join(parts) + ")"


def _scalar_outputs(trace_dir: Path, node_name: str) -> dict[str, Any]:
    """The small half of what a node returned: scalars and short vectors.

    This is what lets a policy **instrument itself**: a node that returns
    ``attempts`` and ``strategy`` beside its real output has those show up in
    the next iteration's feedback, so the agent can choose what it will get to
    see next time. Bulk values — clouds, trajectories, waypoint lists — are
    still dropped rather than truncated; short numeric tuples are not, for the
    reason :func:`_compact_vector` gives.
    """
    output = _load_json(trace_dir / "node_data" / node_name / "output.json")
    if not isinstance(output, dict):
        return {}
    out: dict[str, Any] = {}
    for key, value in output.items():
        if len(out) >= MAX_DETAIL_KEYS:
            break
        if isinstance(value, bool) or isinstance(value, (int, float)):
            out[key] = value
        elif isinstance(value, str) and len(value) <= MAX_DETAIL_CHARS:
            out[key] = value
        else:
            vector = _compact_vector(value)
            if vector is not None:
                out[key] = vector
            elif isinstance(value, dict):
                # One level of nesting, because that is where poses live:
                # {"position": {...}, "rotation": {...}}.
                sub_items = sorted(value.items(), key=lambda kv: kv[0] != "position")
                for sub_key, sub_value in sub_items:
                    if len(out) >= MAX_DETAIL_KEYS:
                        break
                    sub_vector = _compact_vector(sub_value)
                    if sub_vector is not None:
                        out[f"{key}.{sub_key}"] = sub_vector
                    elif isinstance(sub_value, bool) or isinstance(sub_value, (int, float)):
                        out[f"{key}.{sub_key}"] = sub_value
    return out


def _node_summaries(trace: dict[str, Any] | None, trace_dir: Path | None = None) -> list[NodeTraceSummary]:
    """Compress dag_trace.json's node table to what an agent acts on.

    Registered-but-never-started nodes are skipped — the graph's *shape* is in
    the workflow the agent already holds; what the trace adds is which nodes
    ran, how they ended, what the routers decided, and whatever scalars the
    nodes themselves chose to report.
    """
    if not trace:
        return []
    nodes = trace.get("nodes") or []
    # The event stream is the authority on errors. The table used to keep a
    # re-visited node at "running" for good (its close was refused after the
    # first visit), so a node that raised on its second visit had an error in
    # the events and none in the table -- and nothing downstream saw it.
    recorded: dict[str, str] = {}
    for event in trace.get("events") or []:
        if not isinstance(event, dict) or event.get("event_type") != "error_recorded":
            continue
        name = str(event.get("node_name") or "")
        message = str((event.get("detail") or {}).get("error") or "")
        if name and message:
            recorded.setdefault(name, message)
    out: list[NodeTraceSummary] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("status") in (None, "pending"):
            continue
        name_key = str(node.get("name", ""))
        if not node.get("error_message") and name_key in recorded:
            node = {**node, "error_message": recorded[name_key]}
            if node.get("status") == "running":
                node["status"] = "error"
        detail: dict[str, Any] = {}
        # Only when it looped. A backward edge carries no bound, so a retry
        # ladder and a livelock produce the same trace except for this number,
        # and the episode that spun thousands of times reported only that the
        # simulation bus had closed under it.
        visits = node.get("visits")
        if isinstance(visits, int) and visits > 1:
            detail["ran"] = f"{visits}x"
        if node.get("condition_result") is not None:
            detail["route"] = node["condition_result"]
        if trace_dir is not None:
            name = str(node.get("name", ""))
            if name:
                for key, value in _scalar_outputs(trace_dir, name).items():
                    detail.setdefault(key, value)
        out.append(
            NodeTraceSummary(
                node=str(node.get("name", node.get("id", "?"))),
                kind=str(node.get("node_type", "")),
                status=str(node.get("status", "")),
                duration_s=round(float(node.get("duration_ms", 0.0)) / 1000.0, 3),
                error=(str(node["error_message"])[:800] if node.get("error_message") else None),
                detail=detail,
                started_at=(float(node["started_at"]) if isinstance(node.get("started_at"), (int, float)) and node.get("started_at") else None),
            )
        )
    return out


_PLANNING_TARGET_KEYS = ("end", "pose", "target_position", "position")
"""Where a planning call names the place it is aiming for.

`motion.plan_linear` calls it `end`, `motion.plan_joint` and `robot.go_to_pose`
call it `pose`. The surface is not uniform, so the keys are listed rather than
guessed at.
"""


def _planned_poses(trace_dir: Path | None) -> tuple[dict[str, list[float]], dict[str, list[float]]]:
    """``(positions, rotations)`` per node, from the calls each one recorded."""
    positions = _planned_targets(trace_dir)
    rotations: dict[str, list[float]] = {}
    if trace_dir is None:
        return positions, rotations
    for meta_path in sorted(Path(trace_dir).glob("node_data/*/calls/*/request.meta.json")):
        node = meta_path.parent.parent.parent.name
        try:
            request = json.loads((meta_path.parent / "request.json").read_text())
        except Exception:
            continue
        if not isinstance(request, dict):
            continue
        for key in _PLANNING_TARGET_KEYS:
            value = request.get(key)
            rotation = value.get("rotation") if isinstance(value, dict) else None
            if isinstance(rotation, dict) and {"w", "x", "y", "z"} <= set(rotation):
                rotations[node] = [float(rotation[c]) for c in ("w", "x", "y", "z")]
                break
    return positions, rotations


def _planned_targets(trace_dir: Path | None) -> dict[str, list[float]]:
    """Each node's commanded Cartesian target, from the calls it recorded.

    A node that plans and then executes makes two calls, and only the first
    says where in the world it is going -- the trajectory handed to
    `robot.execute_trajectory` is joint waypoints. Pairing them by node is what
    lets a span report how far the arm ended up from where it was sent, which
    is the single most direct evidence that a motion did not do as it was told.

    The *last* planning call in a node wins: a node that plans, finds the pose
    refused, and re-plans somewhere else went to the second place.
    """
    out: dict[str, list[float]] = {}
    if trace_dir is None:
        return out
    for meta_path in sorted(Path(trace_dir).glob("node_data/*/calls/*/request.meta.json")):
        node = meta_path.parent.parent.parent.name
        try:
            request = json.loads((meta_path.parent / "request.json").read_text())
        except Exception:
            continue
        if not isinstance(request, dict):
            continue
        for key in _PLANNING_TARGET_KEYS:
            value = request.get(key)
            position = value.get("position") if isinstance(value, dict) else None
            if isinstance(position, dict) and {"x", "y", "z"} <= set(position):
                out[node] = [float(position[axis]) for axis in ("x", "y", "z")]
                break
    return out


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
