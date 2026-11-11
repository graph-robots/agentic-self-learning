# SPDX-License-Identifier: Apache-2.0
"""Facts derived from a capture: trackers, closest approach, grasp verdicts, attitude, object frames.

No task is named anywhere below; every fixture is a manifest, a tape and the
evaluator's own metric keys.
"""

from __future__ import annotations

import math

import numpy as np

from asl.feedback.extract import (
    _attitude_tracks,
    _closest_approaches,
    _confirm_holds,
    _confirmed_carries,
    _settle_grasp_verdicts,
    behavior_digest,
)
from asl.feedback.facts import FactExtractor, _feature_point, axes_from_up, body_axes, grasp_geometry
from asl.feedback.goals import GOAL_FAMILIES, THREADED, _track_containment, _track_enclosure, _track_threaded
from asl.feedback.schema import (
    Aggregate,
    ArmDelta,
    ArmFact,
    ContactFact,
    EntityDelta,
    EntityFact,
    EpisodeFeedback,
    FeedbackPacket,
    GoalProgress,
    GraspGeometry,
    MotionSpanFact,
    PointFacts,
    StateDelta,
    TrajectorySummary,
)

IDENTITY = [0.0, 0.0, 0.0, 1.0]

# A handle on a movable body 0, a peg welded into scenery (body -1) running
# 0.06 m along -x from x=0.88, both declared exactly as an asset would.
MANIFEST = {
    "entities": {
        "mug": {
            "kind": "object", "body": 0, "static": False, "bbox": [0.26, 0.02, 0.05],
            "xform_xyzw": [0, 0, 0, *IDENTITY],
            "features": {"handle": {"kind": "loop", "center": [0.17, 0.0, 0.0], "normal": [0.0, 1.0, 0.0], "inner_r": 0.014}},
        },
        "rack": {
            "kind": "static", "body": -1, "static": True, "bbox": None,
            "xform_xyzw": [0.88, 0.0, 1.13, *IDENTITY],
            "features": {"peg": {"kind": "rod", "axis": [[-0.06, 0.0, 0.0], [0.0, 0.0, 0.0]], "radius": 0.0025}},
        },
        "table": {"kind": "static", "body": -1, "static": True, "xform_xyzw": [0, 0, 0, *IDENTITY]},
    },
    "regions": {
        "slot": {"frame_body": -1, "origin": [0, 0, 0], "xy_ranges": [0.8, -0.05, 0.9, 0.05], "z_range": [1.0, 1.2]},
    },
}


def _tape(handle_centres: list[list[float]]) -> np.ndarray:
    """A body_q tape in which the mug's body origin puts its handle where asked."""
    return np.asarray([[[c[0] - 0.17, c[1], c[2], *IDENTITY]] for c in handle_centres], dtype=np.float64)


class _Capture:
    """The slice of an episode capture the closest-approach pass reads."""

    def __init__(self, tape: np.ndarray, manifest: dict = MANIFEST) -> None:
        self.arrays = {"body_q": tape, "step": np.arange(len(tape)) * 10}
        self.manifest = manifest

    def point(self, *, step: int):
        raise KeyError(step)


def _span(node: str, start: int, end: int, **kwargs) -> MotionSpanFact:
    return MotionSpanFact(
        span_id=start, node=node, tool="robot.execute_trajectory", arm_id=0, start_step=start, end_step=end,
        delta=StateDelta(start_step=start, end_step=end), trajectory=TrajectorySummary(**kwargs),
    )


# ------------------------------------------------------------------ trackers


def test_enclosure_tracker_reads_the_goals_own_distance_at_every_step():
    tape = _tape([[0.5, 0.0, 0.7], [0.85, 0.0, 1.13], [0.85, 0.0, 1.3]])
    goal = GoalProgress(family="enclosure", object_name="mug.handle", region_name="rack.peg")
    dist, ok = _track_enclosure(goal, MANIFEST, tape)
    assert np.allclose(dist, [np.hypot(0.32, 0.43), 0.0, 0.17], atol=1e-6)
    assert list(ok) == [False, True, False]


def test_closest_approach_names_the_step_the_node_and_that_the_goal_was_reached():
    """Hung on the peg mid-episode, 0.45 m away at the end."""
    tape = _tape([[0.5, 0.0, 0.7], [0.84, 0.0, 1.126], [0.85, 0.0, 1.131], [0.86, 0.0, 1.3], [0.5, 0.0, 0.7]])
    ep = EpisodeFeedback(episode_id=0, seed=0, success=False, steps=40, reward=0.0)
    ep.goal_progress = [GoalProgress(
        family="enclosure", object_name="mug.handle", region_name="rack.peg",
        satisfied=False, xy_distance_end_m=0.45, target_at=[0.82, 0.0, 1.13],
    )]
    ep.motion_spans = [_span("transit", 0, 15), _span("align", 18, 25), _span("release", 26, 40)]
    _closest_approaches(ep, _Capture(tape), None)
    goal = ep.goal_progress[0]
    assert goal.closest_source == "tape"
    assert goal.closest_step == 20 and goal.closest_node == "align"
    assert goal.closest_approach_m == 0.001 and goal.closest_satisfied is True
    # and each span carries the goal's state at its own end
    assert ep.motion_spans[1].goal_states["mug.handle→rack.peg"]["ok"] is True
    assert ep.motion_spans[2].goal_states["mug.handle→rack.peg"]["ok"] is False


def test_a_step_between_spans_is_attributed_to_the_settle_after_the_last_one():
    tape = _tape([[0.5, 0.0, 0.7], [0.5, 0.0, 0.7], [0.83, 0.0, 1.13], [0.5, 0.0, 0.7]])
    ep = EpisodeFeedback(episode_id=0, seed=0, success=False, steps=30, reward=0.0)
    ep.goal_progress = [GoalProgress(family="enclosure", object_name="mug.handle", region_name="rack.peg", xy_distance_end_m=0.5)]
    ep.motion_spans = [_span("place", 0, 12)]
    _closest_approaches(ep, _Capture(tape), None)
    assert ep.goal_progress[0].closest_node == "place (after)"


def test_without_a_tape_the_span_end_method_still_answers_and_says_so():
    ep = EpisodeFeedback(episode_id=0, seed=0, success=False, steps=1, reward=0.0)
    ep.goal_progress = [GoalProgress(
        family="enclosure", object_name="mug.handle", region_name="rack.peg",
        satisfied=False, xy_distance_end_m=0.40, target_at=[1.0, 0.0, 1.0],
    )]
    span = _span("feed", 0, 1)
    span.delta = StateDelta(start_step=0, end_step=1, entities={"mug": EntityDelta(after_position=[0.95, 0.0, 1.0])})
    ep.motion_spans = [span]
    _closest_approaches(ep)
    assert ep.goal_progress[0].closest_source == "span_ends"
    assert ep.goal_progress[0].closest_node == "feed"


def test_containment_tracker_reports_inside_then_lost():
    tape = np.asarray([[[0.5, 0.0, 0.7, *IDENTITY]], [[0.85, 0.0, 1.1, *IDENTITY]], [[0.85, 0.0, 0.7, *IDENTITY]]])
    goal = GoalProgress(family="containment", object_name="mug", region_name="slot", xy_distance_end_m=0.0, z_offset_end_m=-0.3)
    dist, ok = _track_containment(goal, MANIFEST, tape)
    assert list(ok) == [False, True, False] and dist[1] == 0.0
    ep = EpisodeFeedback(episode_id=0, seed=0, success=False, steps=20, reward=0.0)
    ep.goal_progress = [goal]
    ep.motion_spans = [_span("carry", 0, 20)]
    _closest_approaches(ep, _Capture(tape), None)
    assert goal.closest_satisfied is True and goal.closest_node == "carry"


# ------------------------------------------------------------------ threaded

BOARD_MANIFEST = {
    "entities": {
        "board": {
            "kind": "static", "body": -1, "static": True, "xform_xyzw": [0.83, 0.0, 0.85, *IDENTITY],
            "features": {"hole_left": {"kind": "loop", "center": [0.026, 0.02, 0.034], "normal": [0.0, 0.0, 1.0], "inner_r": 0.008}},
        },
        "pin": {
            "kind": "object", "body": 0, "static": False, "bbox": [0.24, 0.03, 0.03], "xform_xyzw": [0, 0, 0, *IDENTITY],
            "features": {"shaft": {"kind": "rod", "axis": [[0.175, 0.0, 0.0], [0.06, 0.0, 0.0]], "radius": 0.003}},
        },
    },
    "regions": {},
}


def _board_metrics() -> dict:
    """An evaluator's own keys for a pin lying flat on the bench beside the board."""
    return {
        "goal.0.0.threaded": False, "goal.0.0.offset": 18.88, "goal.0.0.clearance": -18.88,
        "goal.0.0.crossings": False, "goal.0.0.at": [-18.03, 0.25, 0.884],
        "threaded/board.hole_left/pin.shaft": False, "goal.0.0": False,
        "goal.0.1.force": 0.0, "goal.0.1.force.instant": 0.0, "contact_force/pin/board": False, "goal.0.1": False,
        "goal.0.2.speed": 1.6e-05, "speed/pin": True, "goal.0.2": True,
        "goal.0": False, "goal": False, "threaded": False, "offset": 18.88, "clearance": -18.88, "crossings": False,
        "at": [-18.03, 0.25, 0.884],
    }


class _EndPoint:
    manifest = BOARD_MANIFEST
    arrays: dict = {}


def test_threaded_goals_are_graded_from_the_loops_side_and_never_use_the_crossing():
    specs = THREADED.parse(_board_metrics())
    assert [(s["loop"], s["rod"], s["crossings"]) for s in specs] == [("board.hole_left", "pin.shaft", False)]
    after = PointFacts(
        step=100, sim_time=1.0,
        entities={
            "board": EntityFact(name="board", kind="static", static=True, pose_xyzw=[0.83, 0.0, 0.85, *IDENTITY],
                                features=BOARD_MANIFEST["entities"]["board"]["features"]),
            "pin": EntityFact(name="pin", kind="object", pose_xyzw=[0.6, 0.1, 0.74, *IDENTITY], at_rest=True,
                              features=BOARD_MANIFEST["entities"]["pin"]["features"]),
        },
        arms=[ArmFact(arm_id=0, name="left", holding=None)],
    )
    rows = THREADED.derive(FactExtractor(), specs, after, after, _EndPoint(), _board_metrics())
    assert len(rows) == 1
    goal = rows[0]
    assert goal.family == "threaded" and goal.subject == "pin"
    assert goal.target_center == [0.856, 0.02, 0.884]          # the hole, in the world -- not `at`
    assert goal.xy_distance_end_m is not None and goal.xy_distance_end_m < 1.0
    along, _lateral = goal.tip_offset_m
    assert abs(along - (0.74 - 0.884)) < 1e-3                 # 144 mm below the hole plane
    assert goal.plane_tilt_deg == 90.0                         # lying flat: axis square to the normal


def test_threaded_tracker_knows_when_the_rod_actually_passes_through():
    def upright_at(z0: float) -> list[float]:
        # local +x turned onto world -z: +90 deg about +y (xyzw)
        return [0.856, 0.02, z0, 0.0, 0.7071067811865476, 0.0, 0.7071067811865476]

    tape = np.asarray([[[*upright_at(0.95)]], [[*upright_at(1.00)]], [[*upright_at(1.30)]]])
    goal = GoalProgress(family="threaded", object_name="board.hole_left", region_name="pin.shaft", subject="pin")
    dist, ok = _track_threaded(goal, BOARD_MANIFEST, tape)
    assert list(ok) == [True, True, False]
    assert dist[0] < 1e-6 and dist[1] < 1e-6 and abs(dist[2] - 0.241) < 1e-3


def test_threaded_and_enclosure_do_not_claim_each_others_keys():
    enclosure = next(f for f in GOAL_FAMILIES if f.name == "enclosure")
    assert enclosure.parse(_board_metrics()) == []
    assert THREADED.parse({"encloses/a.handle/b.peg": True, "goal.0.0.encloses": True}) == []


# ------------------------------------------------------- grasp verdict window


def _close_span(obj: str) -> MotionSpanFact:
    span = _span("close", 100, 110, contact_pairs=["arm:left:finger:0 ↔ entity:table", "arm:left:finger:1 ↔ entity:table"])
    span.tool = "robot.close_gripper"
    span.grasp = GraspGeometry(
        span_id=100, arm_id=0, tool="robot.close_gripper", node="close", object_name=obj,
        aperture_end=0.0286, finger_contacts={"finger:0": ["table"], "finger:1": ["table"]}, closed_on="other",
    )
    return span


def _episode_with(*spans: MotionSpanFact) -> EpisodeFeedback:
    ep = EpisodeFeedback(episode_id=0, seed=0, success=False, steps=500, reward=0.0)
    ep.point_end = PointFacts(step=500, sim_time=5.0, arms=[ArmFact(arm_id=0, name="left")])
    ep.motion_spans = list(spans)
    ep.grasp_geometry = [s.grasp for s in spans if s.grasp is not None]
    return ep


def test_a_close_that_seats_on_the_lift_is_a_grasp_not_a_miss():
    lift = _span("lift", 112, 190, ee_path_m=0.196, entity_path_m={"bar": 0.187},
                 contact_pairs=["arm:left:finger:0 ↔ entity:bar", "arm:left:finger:1 ↔ entity:bar"])
    ep = _episode_with(_close_span("bar"), lift)
    _settle_grasp_verdicts(ep)
    grasp = ep.grasp_geometry[0]
    assert grasp.closed_on == "object" and grasp.engaged_node == "lift"
    digest = behavior_digest(FeedbackPacket(iteration=0, task="t", episodes=[ep], aggregate=Aggregate(n=1)))
    assert digest["grasp_summary"]["on_object"] == 1


def test_a_brush_without_a_carry_stays_a_miss():
    lift = _span("lift", 112, 190, ee_path_m=0.196, entity_path_m={}, contact_pairs=["arm:left:finger:0 ↔ entity:bar"])
    ep = _episode_with(_close_span("bar"), lift)
    _settle_grasp_verdicts(ep)
    grasp = ep.grasp_geometry[0]
    assert grasp.closed_on == "other" and grasp.touched_later_node == "lift" and grasp.engaged_node == ""


def test_the_window_closes_at_the_next_release_or_grasp():
    release = _span("release", 112, 120)
    release.tool = "robot.open_gripper"
    carry = _span("carry", 121, 200, ee_path_m=0.2, entity_path_m={"bar": 0.19},
                  contact_pairs=["arm:left:finger:0 ↔ entity:bar"])
    ep = _episode_with(_close_span("bar"), release, carry)
    _settle_grasp_verdicts(ep)
    assert ep.grasp_geometry[0].closed_on == "other" and ep.grasp_geometry[0].engaged_node == ""


def test_a_hold_is_confirmed_only_by_a_carry():
    carried = _span("carry", 0, 10, ee_path_m=0.2, entity_path_m={"bar": 0.19}, contact_pairs=["arm:left:finger:0 ↔ entity:bar"])
    untouched = _span("drift", 0, 10, ee_path_m=0.2, entity_path_m={"bar": 0.19})
    pushed = _span("push", 0, 10, ee_path_m=0.2, entity_path_m={"bar": 0.05}, contact_pairs=["arm:left:finger:0 ↔ entity:bar"])
    assert _confirmed_carries([carried]) == {"bar"}
    assert _confirmed_carries([untouched]) == set() and _confirmed_carries([pushed]) == set()
    ep = EpisodeFeedback(episode_id=0)
    ep.state_delta = StateDelta(start_step=0, end_step=10, arms=[ArmDelta(arm_id=0, grasped="bar")])
    ep.goal_progress = [GoalProgress(object_name="bar", region_name="slot", held_at_end=True)]
    ep.motion_spans = [untouched]
    _confirm_holds(ep)
    assert not ep.state_delta.arms[0].hold_confirmed
    assert ep.goal_progress[0].held_at_end is False and ep.goal_progress[0].closed_around_at_end is True


# ------------------------------------------------------------------ grasp geometry


def _grasp_point(ee, obj_pos, contacts=()):
    return PointFacts(
        step=100, sim_time=1.0,
        entities={
            "bar_17": EntityFact(name="bar_17", kind="object", pose_xyzw=[*obj_pos, *IDENTITY]),
            "table": EntityFact(name="table", kind="scenery", static=True, pose_xyzw=[0, 0, 0, *IDENTITY]),
        },
        arms=[ArmFact(arm_id=1, name="right", ee_pose_xyzw=[*ee, *IDENTITY], gripper_q=[0.002])],
        contacts=list(contacts),
    )


GRASP_MANIFEST = {"entities": {"bar_17": {"bbox": [0.18, 0.04, 0.012]}, "table": {}}}


def test_a_close_on_the_object_reads_inside_its_box():
    contact = ContactFact(shape_a=7, shape_b=9, owner_a="arm:right:finger:0", owner_b="entity:bar_17")
    point = _grasp_point((0.05, 0.0, 0.02), (0.0, 0.0, 0.02), [contact])
    grasp = grasp_geometry(point, [point], 1, GRASP_MANIFEST, tool="robot.close_gripper")
    assert grasp.object_name == "bar_17" and grasp.closed_on == "object"
    assert grasp.object_dims_m == [0.18, 0.04, 0.012]
    assert abs(grasp.offset_axes_m[0] - 0.05) < 1e-6 and grasp.outside_faces_m[0] == 0.0


def test_a_close_past_the_end_face_measures_the_overhang():
    point = _grasp_point((0.11, 0.0, 0.02), (0.0, 0.0, 0.02))
    grasp = grasp_geometry(point, [point], 1, GRASP_MANIFEST, tool="robot.close_gripper")
    assert grasp.object_name == "bar_17" and grasp.closed_on == "nothing"
    assert abs(grasp.outside_faces_m[0] - 0.02) < 1e-6


# ------------------------------------------------------------------ attitude


def _about_y(theta_deg: float) -> list[float]:
    """xyzw quaternion turning the body's +z toward -x: 0 upright, 180 inverted."""
    half = math.radians(theta_deg) / 2.0
    return [0.0, -math.sin(half), 0.0, math.cos(half)]


BOX_MANIFEST = {
    "entities": {
        "box": {
            "kind": "object", "body": 0, "static": False, "bbox": [0.37, 0.525, 0.075],
            "xform_xyzw": [0.7, 0.0, 0.79, *IDENTITY],
            "features": {
                "lid": {"kind": "axis", "origin": [0.0, 0.0, 0.0], "direction": [0.0, 0.0, 1.0]},
                "body": {"kind": "grasp_box", "half": [0.185, 0.0063, 0.031], "center_local": [0.0, 0.256, 0.006]},
            },
        },
        "mat": {
            "kind": "static", "body": -1, "static": True, "xform_xyzw": [0.6, 0.0, 0.002, *IDENTITY],
            "features": {"up": {"kind": "axis", "origin": [0.0, 0.0, 0.0], "direction": [0.0, 0.0, 1.0]}},
        },
    },
}


def _attitude_capture(thetas_deg: list[float]) -> _Capture:
    rows = [[[0.7, 0.0, 0.79, *_about_y(t)]] for t in thetas_deg]
    return _Capture(np.asarray(rows, dtype=np.float64), BOX_MANIFEST)


def test_an_axis_angle_from_up_follows_the_pose():
    features = BOX_MANIFEST["entities"]["box"]["features"]
    for theta in (0.0, 45.0, 90.0, 120.0, 180.0):
        out = axes_from_up(features, np.asarray([0.7, 0.0, 0.79, *_about_y(theta)]))
        assert set(out) == {"lid"}, "only the axis feature is an attitude; the grasp box is not"
        assert abs(out["lid"] - theta) < 0.2


def test_the_tape_track_reports_the_peak_and_the_digest_keeps_it():
    ep = EpisodeFeedback(episode_id=3)
    _attitude_tracks(ep, _attitude_capture([0.0, 30.0, 72.4, 71.0, 5.0, 0.2]))
    track = ep.attitude_tracks["box.lid"]
    assert (track["start_deg"], track["peak_deg"], track["peak_step"], track["end_deg"]) == (0.0, 72.4, 20, 0.2)
    assert "mat.up" not in ep.attitude_tracks, "a static's axis is scenery, not an outcome"
    digest = behavior_digest(FeedbackPacket(iteration=1, task="t", episodes=[ep], aggregate=Aggregate(n=1)))
    assert digest["attitude_peaks"] == {"box.lid": 72.4}


# ------------------------------------------------------------------ object frames


def test_body_axes_order_by_the_box_and_rotate_into_the_body():
    pose = np.asarray([0.0, 0.0, 0.0, *IDENTITY])
    components, dims = body_axes(pose, np.asarray([0.01, 0.02, 0.03]), np.asarray([0.02, 0.30, 0.05]))
    assert dims == [0.30, 0.05, 0.02] and np.allclose(components, [0.02, 0.03, 0.01])
    turned = np.asarray([0.0, 0.0, 0.0, 0.0, 0.0, math.sin(math.pi / 4), math.cos(math.pi / 4)])  # +90 deg about z
    components, _ = body_axes(turned, np.asarray([0.0, 0.1, 0.0]), np.asarray([0.3, 0.02, 0.05]))
    assert np.allclose(components, [0.1, 0.0, 0.0], atol=1e-9)  # world +y is the body's long (+x) axis
    components, dims = body_axes(pose, np.asarray([0.1, 0.0, 0.0]), None)
    assert dims == [] and np.allclose(components, [0.1, 0.0, 0.0])


def test_a_feature_point_is_a_centre_or_an_axis_midpoint():
    assert np.allclose(_feature_point({"center": [0.1, 0.0, 0.0]}), [0.1, 0.0, 0.0])
    assert np.allclose(_feature_point({"axis": [[0.0, 0.0, 0.0], [0.2, 0.0, 0.0]]}), [0.1, 0.0, 0.0])
    assert _feature_point({"half": [0.1, 0.1, 0.1]}) is None
