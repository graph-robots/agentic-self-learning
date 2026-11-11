# SPDX-License-Identifier: Apache-2.0
"""Feedback conditions: each one shows its facts and none of a wider condition's.

One rich packet (a mug carried to a rack, hung by its handle on a peg, then
lost on release while the graph raised) rendered under every condition. The
gates are asserted on tokens that belong to exactly one form, spatial level or
granularity, so a leak shows up as a token where it must not be.
"""

from __future__ import annotations

import re

import pytest

from asl.config import FeedbackConfig
from asl.feedback import render
from asl.feedback.design import narrate_features
from asl.feedback.frames import choose_cameras, stage_frames
from asl.feedback.schema import (
    AbortFact,
    Aggregate,
    ArmDelta,
    ArmFact,
    EntityDelta,
    EntityFact,
    EpisodeFeedback,
    FeedbackPacket,
    GoalProgress,
    GraspGeometry,
    IterationSummary,
    MotionSpanFact,
    NodeTraceSummary,
    PointFacts,
    SlimArm,
    SlimEntity,
    SlimPoint,
    StateDelta,
    UnitFrame,
)

HANDLE = {"kind": "loop", "center": [0.17, 0.0, 0.0], "normal": [0.0, 0.0, 1.0], "inner_r": 0.014}
PEG = {"kind": "rod", "axis": [[0.06, 0.0, 0.0], [0.0, 0.0, 0.0]], "radius": 0.0025}
FLAT = [0.0, 0.0, 0.0, 1.0]
UPRIGHT = [0.0, 0.7071068, 0.0, 0.7071068]  # the mug's long (x) axis turned to world z


def _slim(step, mug_pos, mug_q, hand_pos, *, holding=None, rest_on="table", long_deg=90.0) -> SlimPoint:
    return SlimPoint(
        step=step,
        entities={"mug_1": SlimEntity(
            position=mug_pos, quat_xyzw=mug_q, bbox_m=[0.24, 0.03, 0.01], at_rest=True,
            resting_on=rest_on, long_axis_deg=long_deg,
        )},
        arms=[SlimArm(arm_id=0, name="right", ee_position=hand_pos, ee_quat_xyzw=[1.0, 0.0, 0.0, 0.0], holding=holding)],
    )


def _point(step, mug_pos, mug_q, hand_pos, *, rest_on="table", long_deg=90.0) -> PointFacts:
    return PointFacts(
        step=step, sim_time=step / 60.0,
        entities={
            "mug_1": EntityFact(
                name="mug_1", kind="object", bbox_m=[0.24, 0.03, 0.01], features={"handle": HANDLE},
                pose_xyzw=[*mug_pos, *mug_q], at_rest=True, resting_on=rest_on,
                long_axis_from_vertical_deg=long_deg,
            ),
            "rack_1": EntityFact(
                name="rack_1", kind="fixture", static=True, features={"peg": PEG},
                pose_xyzw=[0.85, 0.0, 1.13, 0.0, 0.0, 0.0, 1.0],
            ),
            "table": EntityFact(name="table", static=True, pose_xyzw=[0.5, 0.0, 0.7, 0.0, 0.0, 0.0, 1.0]),
        },
        arms=[ArmFact(arm_id=0, name="right", ee_pose_xyzw=[*hand_pos, 1.0, 0.0, 0.0, 0.0])],
    )


GOAL = "mug_1.handle→rack_1.peg"


def _span(span_id, tool, node, start, end, after, **kw) -> MotionSpanFact:
    return MotionSpanFact(
        span_id=span_id, tool=tool, node=node, start_step=start, end_step=end,
        delta=kw.pop("delta", StateDelta(start_step=start, end_step=end)), after_state=after, **kw,
    )


def _failed_episode() -> EpisodeFeedback:
    start = _point(0, [0.60, 0.02, 0.74], FLAT, [0.67, 0.17, 1.16])
    end = _point(900, [0.84, 0.01, 1.05], UPRIGHT, [0.80, 0.0, 1.20], rest_on="rack_1", long_deg=5.0)
    spans = [
        _span(0, "robot.go_to_pose", "grasp_sg.approach", 10, 100,
              _slim(100, [0.60, 0.02, 0.74], FLAT, [0.69, 0.02, 0.75]),
              target_position=[0.69, 0.02, 0.75], position_error_m=0.004, rotation_error_deg=12.0),
        _span(1, "robot.close_gripper", "grasp_sg.close", 100, 200,
              _slim(200, [0.60, 0.02, 0.74], FLAT, [0.69, 0.02, 0.75], holding="mug_1"),
              delta=StateDelta(start_step=100, end_step=200,
                               contacts_started=["arm:right:finger:0 ↔ entity:mug_1"],
                               arms=[ArmDelta(arm_id=0, name="right", grasped="mug_1", hold_confirmed=True)]),
              grasp=GraspGeometry(span_id=1, tool="robot.close_gripper", node="grasp_sg.close",
                                  ee_position=[0.69, 0.02, 0.75], object_name="mug_1",
                                  offset_axes_m=[0.088, -0.001, 0.008], outside_faces_m=[0.0, 0.0, 0.003],
                                  nearest_feature="handle 83 mm", closed_on="object", aperture_end=0.0137)),
        _span(2, "robot.execute_trajectory", "hang_sg.carry", 200, 600,
              _slim(600, [0.84, 0.01, 1.08], UPRIGHT, [0.80, 0.0, 1.20], holding="mug_1", rest_on=None, long_deg=5.0),
              delta=StateDelta(start_step=200, end_step=600, contacts_ended=["entity:mug_1 ↔ entity:table"],
                               entities={"mug_1": EntityDelta(displacement_m=0.43, before_position=[0.60, 0.02, 0.74],
                                                              after_position=[0.84, 0.01, 1.08])}),
              goal_states={GOAL: {"ok": True, "distance_m": 0.004}}),
        _span(3, "robot.open_gripper", "hang_sg.release", 600, 700,
              _slim(700, [0.84, 0.01, 1.05], UPRIGHT, [0.80, 0.0, 1.20], rest_on="rack_1", long_deg=5.0),
              delta=StateDelta(start_step=600, end_step=700,
                               arms=[ArmDelta(arm_id=0, name="right", released="mug_1")]),
              goal_states={GOAL: {"ok": False, "distance_m": 0.031}}),
    ]
    nodes = [
        NodeTraceSummary(node="perceive_sg.look", kind="script", status="ok", duration_s=2.0, started_at=0.5,
                         detail={"obb.center": "(x=0.6, y=0.02, z=0.74)", "obb.rotation": "(x=0, y=0, z=0, w=1)",
                                 "mask": "<ndarray shape=(4, 4) dtype=uint8>"}),
        NodeTraceSummary(node="grasp_sg.approach", kind="script", status="ok", duration_s=3.0, started_at=1.0),
        NodeTraceSummary(node="grasp_sg.close", kind="tool", status="ok", duration_s=2.0, started_at=2.0),
        NodeTraceSummary(node="hang_sg.carry", kind="script", status="ok", duration_s=9.0, started_at=3.0),
        NodeTraceSummary(node="hang_sg.release", kind="script", status="error", duration_s=1.0, started_at=4.0,
                         error="RuntimeError: hang check failed"),
    ]
    return EpisodeFeedback(
        episode_id=0, success=False, steps=900, close_kind="policy_request",
        abort=AbortFact(node="hang_sg.release", error="RuntimeError: hang check failed", step=700),
        graph_error="first node error -- hang_sg.release: RuntimeError",
        seed=7, reward=0.25, evaluator_metrics={"encloses/mug_1.handle/rack_1.peg": False, "goal.0.offset": 0.031},
        point_start=start, point_end=end,
        state_delta=StateDelta(
            start_step=0, end_step=900,
            entities={"mug_1": EntityDelta(displacement_m=0.46, before_position=[0.60, 0.02, 0.74],
                                           after_position=[0.84, 0.01, 1.05])},
            contacts_started=["entity:mug_1 ↔ entity:rack_1"],
            contacts_ended=["entity:mug_1 ↔ entity:table"],
        ),
        motion_spans=spans,
        grasp_geometry=[spans[1].grasp],
        goal_progress=[GoalProgress(
            family="enclosure", object_name="mug_1.handle", region_name="rack_1.peg", subject="mug_1",
            satisfied=False, fraction_end=0.0, xy_distance_end_m=0.031, feature_offset_m=[0.012, -0.020, 0.004],
            plane_tilt_deg=22.0, target_at=[0.82, 0.0, 1.137],
        )],
        nodes=nodes,
        unit_frames=[
            UnitFrame(unit="node:hang_sg.release", when="after", camera="overhead", step=700,
                      path="/nonexistent/overhead_000700.png", name="e0_node-hang_sg_release_after_overhead.png"),
        ],
    )


def _packet() -> FeedbackPacket:
    failed = _failed_episode()
    passed = EpisodeFeedback(episode_id=1, success=True, steps=850, close_kind="policy_request")
    return FeedbackPacket(
        iteration=2, task="mug_rack", variant="base", instruction="hang the mug on the rack",
        aggregate=Aggregate(n=2, successes=1, success_rate=0.5, episodes_requested=2, aborted=1,
                            abort_nodes={"hang_sg.release": 1}, first_graph_error="RuntimeError: hang check failed",
                            median_steps=875.0),
        episodes=[failed, passed],
        declared_features={"mug_1": {"handle": HANDLE}, "rack_1": {"peg": PEG}},
        history=[IterationSummary(
            iteration=1, train_success_rate=0.25, train_n=4, change="I raised the rack approach",
            failure_stages={"hang_sg.release": 3}, failure_errors={"hang_sg.release": "hang check failed"},
            goal_outcomes={GOAL: {"failed_n": 3, "median_xy_end_m": 0.04, "closest_m": 0.004,
                                  "reached_then_lost_n": 2, "held_n": 0}},
            grasp_summary={"attempts": 4, "on_object": 4, "carried": 4},
        )],
    )


CONDITIONS = {
    "success": {"form": []},
    "visual": {"form": ["visual"]},
    "state": {"form": ["state"]},
    "relations": {"form": ["relations"]},
    "reference": {"form": ["state", "relations"]},
    "positions": {"form": ["state", "relations"], "spatial": "positions"},
    "frames": {"form": ["state", "relations"], "spatial": "frames"},
    "episode": {"form": ["state", "relations"], "granularity": "episode"},
    "motion": {"form": ["state", "relations"], "granularity": "motion"},
}


def _render(name: str) -> str:
    return render(_packet(), FeedbackConfig(**CONDITIONS[name]))


def _sim_lines(text: str) -> str:
    """The simulation-feedback lines: without the outcome's own error and the node headings."""
    keep = []
    for line in text.splitlines():
        if line.startswith("- **`") or "raised" in line or line.startswith("| ") or "first recorded error" in line:
            continue
        keep.append(line)
    return "\n".join(keep)


NUMBER = re.compile(r"\d\.\d{3}\b")
ORIENTATION = re.compile(r"°|long axis|hand frame|own axes|stands on end|lies flat|is tilted|in the hand frame")
PARTS = re.compile(r"\bhandle\b|\bpeg\b|declared part")
PREDICATE = re.compile(r"came into contact|stopped touching|rests on|let go|grasped|fingers are closed|the close met|goal geometry|goal met|goal not met|encloses")


@pytest.mark.parametrize("name", sorted(CONDITIONS))
def test_every_condition_renders_the_outcome(name):
    text = _render(name)
    assert "Train result: 1/2 episodes succeeded" in text
    assert "| 0 | no | 900 | policy_request (graph raised at `hang_sg.release`) |" in text
    # The policy's own error is outcome: every condition, even outcome-only.
    assert "hang check failed" in text
    # The evaluator's bookkeeping is in no condition.
    assert "goal.0.offset" not in text and "seed" not in text.lower().split("feedback")[0]


def test_success_only_shows_no_simulation_feedback():
    text = _render("success")
    body = _sim_lines(text)
    assert not NUMBER.search(body.split("## What has been tried")[0].split("| iteration")[0])
    assert not PREDICATE.search(body) and not ORIENTATION.search(body) and not PARTS.search(body)
    assert "Motion" not in text and "frames/" not in text and "At the start" not in text
    assert "outcome only" in text


def test_state_has_numbers_and_no_predicates():
    body = _sim_lines(_render("state"))
    assert NUMBER.search(body)
    assert not PREDICATE.search(body), PREDICATE.findall(body)


def test_relations_has_predicates_and_no_numbers():
    body = _sim_lines(_render("relations"))
    assert PREDICATE.search(body)
    assert "encloses rack_1.peg: yes" in body and "encloses rack_1.peg: no" in body
    assert "no longer: arm 0's fingers are closed on mug_1" in body
    assert not NUMBER.search(body), NUMBER.findall(body)
    assert "[0." not in body


def test_positions_never_names_an_orientation_or_a_part():
    text = _render("positions")
    body = _sim_lines(text)
    assert "[0.600, 0.020, 0.740]" in body
    assert not ORIENTATION.search(body), ORIENTATION.findall(body)
    assert not PARTS.search(text), PARTS.findall(text)
    # Object-level goal predicates below `parts`.
    assert "mug_1 → rack_1: goal geometry holds" in body
    # The node heading keeps the policy's position output and drops its rotation.
    assert "obb.center=" in text and "obb.rotation" not in text and "<ndarray" not in text


def test_frames_add_orientation_but_no_parts():
    text = _render("frames")
    body = _sim_lines(text)
    assert ORIENTATION.search(body)
    assert "long axis" in body and "own axes" in body
    assert "mug_1 stands on end" in body
    assert not PARTS.search(text), PARTS.findall(text)
    assert "in rack_1's frame" in body


def test_parts_name_the_declared_parts():
    text = _render("reference")
    assert "Declared parts" in text and "`mug_1.handle` — a loop" in text
    assert "nearest declared part: handle 83 mm" in text
    assert "relative to rack_1.peg's tip" in text
    assert "plane is 22° off" in text


def test_episode_units_name_no_tool_and_no_node():
    body = _sim_lines(_render("episode"))
    assert "robot." not in body
    assert "_sg" not in body
    assert "Start → end" in body and "at the start:" in body and "at the end:" in body


def test_motion_units_name_tools_never_nodes():
    text = _render("motion")
    body = _sim_lines(text)
    assert "`robot.close_gripper`" in body and "→ toward [0.690, 0.020, 0.750]" in body
    assert "_sg" not in body
    assert "your graph's error was raised during this motion" in text


def test_semantic_units_roll_nodes_up_to_their_subgraphs_in_execution_order():
    text = _render("reference")
    order = [text.index(f"### `{sg}`") for sg in ("perceive_sg", "grasp_sg", "hang_sg")]
    assert order == sorted(order)
    assert "**`grasp_sg.close`** (tool, ok" in text
    assert "raised: RuntimeError: hang check failed" in text


def test_visual_condition_cites_stills_by_workspace_name_and_nothing_else():
    text = _render("visual")
    assert "`frames/e0_node-hang_sg_release_after_overhead.png`" in text
    body = _sim_lines(text)
    assert not NUMBER.search(body) and not PREDICATE.search(body)
    # Only units with stills are listed: no bare trace.
    assert "grasp_sg.close" not in text


def test_view_strips_what_the_condition_cannot_use():
    packet = _packet()
    visual = packet.view(FeedbackConfig(form=["visual"]))
    episode = visual.episodes[0]
    assert episode.evaluator_metrics == {} and episode.seed is None
    assert episode.goal_progress == [] and episode.point_end is None and visual.declared_features == {}
    assert all(s.after_state is None and not s.goal_states and s.grasp is None for s in episode.motion_spans)
    assert episode.unit_frames and episode.nodes  # semantic labels for its stills
    assert packet.view(FeedbackConfig(form=["state"], spatial="frames")).declared_features == {}
    assert packet.view(FeedbackConfig(form=["state"], granularity="motion")).episodes[0].nodes == []
    success = packet.view(FeedbackConfig(form=[]))
    assert success.episodes[0].motion_spans == [] and success.episodes[0].unit_frames == []


def test_history_is_gated_like_the_packet():
    success = _render("success")
    assert "graphs raised at `hang_sg.release` ×3" in success  # own errors: outcome
    assert "closest" not in success and "held at the end" not in success and "grasp attempts" not in success
    relations = _render("relations")
    assert "reached the goal geometry and then lost it in 2/3" in relations and "closest" not in relations
    state = _render("state")
    assert "closest 0.004 m" in state and "held at the end" not in state
    episode = _render("episode")
    assert "closest" not in episode and "reached the goal geometry" not in episode


def test_the_outcome_and_the_history_agree_on_where_a_graph_raised():
    from asl.feedback.extract import behavior_digest

    cut_off = EpisodeFeedback(
        episode_id=0, success=False, steps=1201, close_kind="truncated",
        nodes=[NodeTraceSummary(node="pick_sg.lift", status="error", error="BusClosed: the episode ended")],
    )
    finished = EpisodeFeedback(
        episode_id=1, success=False, steps=600, close_kind="policy_request",
        nodes=[NodeTraceSummary(node="pick_sg.grip", status="error", error="RuntimeError: carried on past")],
    )
    raised = EpisodeFeedback(
        episode_id=2, success=False, steps=300, close_kind="policy_request",
        nodes=[NodeTraceSummary(node="place_sg.drop", status="error", error="RuntimeError: dropped")],
        abort=AbortFact(node="place_sg.drop", error="RuntimeError: dropped", step=300),
        graph_error="first node error -- place_sg.drop: RuntimeError",
    )
    batch = FeedbackPacket(
        iteration=0, task="t", variant="base", instruction="i",
        aggregate=Aggregate(n=3, aborted=1, abort_nodes={"place_sg.drop": 1}), episodes=[cut_off, finished, raised],
    )
    outcome = render(batch, FeedbackConfig(form=[]))
    assert "1 of 3 episodes exhausted ~1201 control steps" in outcome
    assert "**1 failed episode(s) raised nothing — your graph finished" in outcome
    assert "Where the failed episodes' graphs raised: `place_sg.drop` ×1." in outcome
    digest = behavior_digest(batch)
    assert digest["failure_stages"] == {"(out of steps)": 1, "(claimed success)": 1, "place_sg.drop": 1}
    assert digest["failure_errors"] == {"place_sg.drop": "RuntimeError: dropped"}
    later = batch.model_copy(update={"iteration": 1, "history": [IterationSummary(iteration=0, **digest)]})
    history = render(later, FeedbackConfig(form=[])).split("## What has been tried so far")[1]
    assert "graphs raised at `place_sg.drop` ×1" in history
    assert "1 ran out of control steps without raising" in history and "1 finished without raising and missed" in history
    assert "pick_sg" not in history and "BusClosed" not in history


def test_stage_frames_copies_the_cited_stills(tmp_path):
    still = tmp_path / "overhead_000700.png"
    still.write_bytes(b"png")
    packet = _packet()
    packet.episodes[0].unit_frames[0].path = str(still)
    written = stage_frames(packet.view(FeedbackConfig(form=["visual"])), tmp_path / "frames")
    assert [p.name for p in written] == ["e0_node-hang_sg_release_after_overhead.png"]
    assert stage_frames(packet, tmp_path / "none") == []  # not a view: nothing staged


def test_a_rig_without_a_hand_camera_still_gets_two_views():
    assert choose_cameras(["eye_in_hand_left", "overhead"]) == ["overhead", "eye_in_hand_left"]
    assert choose_cameras(["front", "overhead"]) == ["overhead", "front"]
    assert choose_cameras(["agentview", "eye_in_hand", "overhead"]) == ["overhead", "eye_in_hand"]
    assert choose_cameras(["a", "b"], ("b", "missing")) == ["b"]


def test_declared_parts_narrate_every_axis_shape():
    """A rod's axis is two end points; a cavity's is a direction beside its mouth."""
    lines = narrate_features({
        "rack": {"peg": PEG},
        "socket": {"bore": {
            "kind": "cavity", "mouth": [0.0, 0.0, 0.013], "axis": [0.0, 0.0, -1.0],
            "depth": 0.013, "half_extents": [0.0084, 0.0026],
        }},
    })
    assert lines[0].startswith("`rack.peg` — a rod from [0.06, 0, 0] to [0, 0, 0], radius 0.0025")
    assert "a cavity opening at [0, 0, 0.013], running along [0, 0, -1], depth 0.013" in lines[1]
