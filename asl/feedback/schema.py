# SPDX-License-Identifier: Apache-2.0
"""The feedback's data: facts derived from a capture, and the packet built from them.

Two layers. The fact models (``EntityFact`` ... ``MotionSpanFact``) are what
:mod:`asl.feedback.facts` derives from one episode's raw capture; they name
nothing task-specific. The packet models (``EpisodeFeedback`` ...
``FeedbackPacket``) hold one training batch: every fact for every episode,
whatever the run's feedback condition. A condition's view of the packet
(:meth:`FeedbackPacket.view`) drops what that condition never shows, and the
renderer (:mod:`asl.feedback.design`) decides the rest.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1


# ------------------------------------------------------------------ facts


class ContactFact(BaseModel):
    shape_a: int
    shape_b: int
    owner_a: str = ""
    owner_b: str = ""
    impulse_ns: list[float] = Field(default_factory=list)
    impulse_norm_ns: float = 0.0
    distance_m: float = 0.0


class EntityFact(BaseModel):
    name: str
    kind: str = ""
    asset_type: str = ""
    bbox_m: list[float] = Field(default_factory=list)
    """The entity's box extents, in its own frame order; :func:`~asl.feedback.facts.body_axes`
    sorts by them to name the long, mid and short axes."""
    features: dict[str, dict] = Field(default_factory=dict)
    """The parts this entity's asset declares, in its own local frame, e.g.
    ``{"rim": {"kind": "loop", "center": [...], "normal": [...], "inner_r": ...}}``.
    A goal can be written and scored in this vocabulary, so the agent needs to
    know the names exist."""
    static: bool = False
    pose_xyzw: list[float] = Field(default_factory=list)
    linear_speed_m_s: float | None = None
    at_rest: bool | None = None
    region_fractions: dict[str, float] = Field(default_factory=dict)
    long_axis_from_vertical_deg: float | None = None
    """Angle between the entity's longest box axis and world z [deg]: 0 is
    standing on end, 90 lying flat. ``None`` for a body whose box is not
    clearly elongated, where the number would mean nothing."""
    axes_from_up_deg: dict[str, float] = Field(default_factory=dict)
    """Per declared ``axis`` feature, its angle from world up [deg]: 0 pointing
    up, 90 on its side, 180 inverted. The attitude of a body whose long axis
    says nothing (a box that is flipped over keeps its long axis horizontal)."""
    resting_on: str | None = None
    """The entity this one touches while at rest: "on the lid" and "on the
    bench" can share a z coordinate."""
    above_region_m: dict[str, float] = Field(default_factory=dict)
    """Regions whose x-y footprint contains this entity while it is above
    their z window, by clearance [m]: an object resting on a lid is right
    above its goal region and in no region at all."""
    extent_m: list[float] | None = None
    """Axis-aligned size of a deformable's particle cloud [dx, dy, dz, m]; a
    centroid alone barely moves while a cloth folds or peels."""


class ArmFact(BaseModel):
    arm_id: int
    name: str = ""
    role: str = ""
    ee_pose_xyzw: list[float] = Field(default_factory=list)
    joint_q: list[float] = Field(default_factory=list)
    gripper_q: list[float] = Field(default_factory=list)
    holding: str | None = None
    holding_contact_sides: int = 0


class PointFacts(BaseModel):
    step: int
    sim_time: float
    entities: dict[str, EntityFact] = Field(default_factory=dict)
    arms: list[ArmFact] = Field(default_factory=list)
    contacts: list[ContactFact] = Field(default_factory=list)


class GoalProgress(BaseModel):
    """How far one goal got, graded, where the evaluator gives only a verdict.

    Goals are read from the evaluator's own metric keys (see
    :mod:`asl.feedback.goals`), never from a task name, so any task whose
    evaluator speaks a known metric shape gets these rows. Distances come from
    the same capture geometry the region fractions use.

    For containment, ``xy_distance_*_m`` is the distance from the object's
    centre to the region's x-y footprint (0 inside it), and ``z_offset_end_m``
    where the object ended against the region's z window (positive above,
    negative below, 0 inside). An object at xy 0 with a positive z offset is
    right above its goal and blocked from entering. Other families reuse some
    of these slots; their modules say how.
    """

    family: str = "containment"
    """Which metric shape produced this row."""
    object_name: str
    region_name: str = ""
    subject: str = ""
    """The movable body this goal's hold, carry and contact facts are about.
    Empty means ``object_name``'s base body; for ``threaded`` the named loop is
    the fixture and the carried body is the rod."""
    satisfied: bool | None = None
    fraction_end: float = 0.0
    xy_distance_start_m: float | None = None
    xy_distance_end_m: float | None = None
    z_offset_end_m: float | None = None
    held_at_end: bool = False
    closed_around_at_end: bool = False
    """Two-sided finger contact at the end without evidence the object ever
    moved with the hand: the hand is closed around it, and a hold is unverified."""
    at_rest_end: bool | None = None
    target_at: list[float] = Field(default_factory=list)
    """The goal's own target point [m, world], when the evaluator publishes one."""
    closest_approach_m: float | None = None
    """Nearest the goal geometry came to holding over the episode.

    Measured at every recorded step when the family can track its geometry
    (``closest_source == "tape"``), else at motion-span ends (``"span_ends"``).
    The nearest point of an episode is rarely a span's last step."""
    closest_node: str = ""
    """The workflow node whose span contained that step (or whose settle it fell in)."""
    closest_step: int | None = None
    """The control step of the nearest approach."""
    closest_satisfied: bool | None = None
    """Whether the family's geometric verdict held at that step. True on a
    failed episode means the goal was reached and then lost."""
    closest_contacts: list[str] = Field(default_factory=list)
    """What the goal object was touching at that step."""
    closest_source: str = ""
    """``"tape"`` or ``"span_ends"``."""
    tip_offset_m: list[float] = Field(default_factory=list)
    """For a rod-through-loop goal graded from the loop's side: the rod's
    nearer end relative to the loop's centre, [along the loop's normal (signed),
    in-plane lateral]."""
    target_center: list[float] = Field(default_factory=list)
    """The target feature's own centre [m, world] when it is a loop."""
    feature_offset_m: list[float] = Field(default_factory=list)
    """End offset of the goal part from its target feature, [along the
    target's axis, vertical, lateral], from the declared features and the live
    poses. A centroid distance hides where a part sits relative to another."""
    plane_tilt_deg: float | None = None
    """Angle between the loop's plane normal and the rod's axis [deg]: 0 is aligned."""
    readings_nonfinite: bool = False
    """The evaluator's graded readings for this goal were NaN or inf: the
    simulation's state diverged, which differs from a goal that was not graded."""


class EntityDelta(BaseModel):
    displacement_m: float = 0.0
    displacement_axes_m: list[float] = Field(default_factory=list)
    """The displacement in the entity's own axes, ``[long, mid, short]``, at the
    interval's start: sliding along its length reads differently from rolling
    across it. Empty when the entity has no box to order the axes by."""
    orientation_change_rad: float = 0.0
    before_position: list[float] = Field(default_factory=list)
    after_position: list[float] = Field(default_factory=list)
    before_speed_m_s: float | None = None
    after_speed_m_s: float | None = None
    at_rest: bool | None = None
    entered: list[str] = Field(default_factory=list)
    left: list[str] = Field(default_factory=list)
    region_fraction_delta: dict[str, float] = Field(default_factory=dict)


class ArmDelta(BaseModel):
    arm_id: int
    name: str = ""
    ee_displacement_m: float = 0.0
    grasped: str | None = None
    released: str | None = None
    holding_after: str | None = None
    hold_confirmed: bool = False
    """Whether the object provably moved with the hand, not merely touched it.

    ``grasped`` comes from two-sided finger contact, which a hand closed
    around an object resting on the table also satisfies. Set when some motion
    span shows the object's path matching the hand's."""


class StateDelta(BaseModel):
    start_step: int
    end_step: int
    elapsed_s: float = 0.0
    entities: dict[str, EntityDelta] = Field(default_factory=dict)
    arms: list[ArmDelta] = Field(default_factory=list)
    contacts_started: list[str] = Field(default_factory=list)
    contacts_ended: list[str] = Field(default_factory=list)


class TrajectorySummary(BaseModel):
    point_count: int = 0
    duration_s: float = 0.0
    ee_path_m: float = 0.0
    max_ee_step_m: float = 0.0
    entity_path_m: dict[str, float] = Field(default_factory=dict)
    contact_pairs: list[str] = Field(default_factory=list)


class GraspGeometry(BaseModel):
    """Where a close landed, relative to the thing it meant to hold.

    Offsets are in the object's own box axes, longest first, so "41 mm along
    the long axis, 8 mm beyond its end face" reads the same for every object.
    Built from the capture alone: arm pose, entity pose, manifest box, contacts.
    """

    span_id: int = 0
    arm_id: int = 0
    tool: str = ""
    node: str = ""
    ee_position: list[float] = Field(default_factory=list)
    aperture_end: float | None = None
    object_name: str | None = None
    object_dims_m: list[float] = Field(default_factory=list)
    """Full box extents, longest first, to match ``offset_axes_m``."""
    offset_axes_m: list[float] = Field(default_factory=list)
    """Hand minus object centre, in the object's box axes (longest first)."""
    outside_faces_m: list[float] = Field(default_factory=list)
    """Per axis, how far the hand sits beyond the box face (0 inside)."""
    nearest_feature: str = ""
    """The declared part the jaws closed nearest to, and how far, e.g. ``"handle 41 mm"``."""
    finger_contacts: dict[str, list[str]] = Field(default_factory=dict)
    """Per finger label, the entities it touched during the span."""
    closed_on: str = ""
    """``"object"``, ``"other"`` or ``"nothing"``: what the fingers met, judged
    over the close and the motion that follows it (see ``engaged_node``)."""
    engaged_node: str = ""
    """The later span in which the fingers took the object and it moved with
    the hand, when the close itself met only what was beside it. A grasp on
    thin stock can seat as the hand rises. Empty when the close met the object
    or nothing later carried it."""
    touched_later_node: str = ""
    """The later span in which a finger first touched the object without ever
    carrying it before the next release: a brush, not a grasp."""
    moved_during_close_m: float | None = None
    """How far the object travelled while the jaws were shutting. A part that
    leaves during the close is a different failure from one the approach never
    reached, though both end with the jaws shut on nothing."""
    rotated_during_close_rad: float | None = None
    moved_before_close_m: float | None = None
    """How far the object moved during the same arm's preceding motion, so a
    knock on the way in is told apart from an ejection during the close."""
    moved_before_close_node: str = ""
    ejected: bool = False
    """The close itself threw the part: it moved or turned during the close
    and nothing carried it afterwards."""


class SlimEntity(BaseModel):
    """One movable entity at one instant, as much as a feedback unit needs.

    A span's delta says what changed inside it; this says where things were
    when it ended. Kept small (movable entities only, no contacts table)
    because a batch keeps one per span."""

    position: list[float] = Field(default_factory=list)
    quat_xyzw: list[float] = Field(default_factory=list)
    bbox_m: list[float] = Field(default_factory=list)
    at_rest: bool | None = None
    resting_on: str | None = None
    regions: dict[str, float] = Field(default_factory=dict)
    above: dict[str, float] = Field(default_factory=dict)
    long_axis_deg: float | None = None
    axes_from_up_deg: dict[str, float] = Field(default_factory=dict)


class SlimArm(BaseModel):
    arm_id: int = 0
    name: str = ""
    ee_position: list[float] = Field(default_factory=list)
    ee_quat_xyzw: list[float] = Field(default_factory=list)
    holding: str | None = None
    contact_sides: int = 0


class SlimPoint(BaseModel):
    """A feedback unit's boundary: movables, hands and who touches whom."""

    step: int = 0
    entities: dict[str, SlimEntity] = Field(default_factory=dict)
    arms: list[SlimArm] = Field(default_factory=list)
    contacts: list[str] = Field(default_factory=list)
    """Contact pairs at that instant (``a ↔ b`` owner labels) that involve a
    movable entity or a finger; static-on-static pairs are scenery."""


def slim_point(point: PointFacts) -> SlimPoint:
    """:class:`PointFacts` cut to what a unit boundary needs."""
    movable = {name for name, e in point.entities.items() if not e.static}
    entities = {
        name: SlimEntity(
            position=[round(float(v), 5) for v in e.pose_xyzw[:3]],
            quat_xyzw=[round(float(v), 5) for v in e.pose_xyzw[3:7]],
            bbox_m=list(e.bbox_m),
            at_rest=e.at_rest,
            resting_on=e.resting_on,
            regions=dict(e.region_fractions),
            above=dict(e.above_region_m),
            long_axis_deg=e.long_axis_from_vertical_deg,
            axes_from_up_deg=dict(e.axes_from_up_deg),
        )
        for name, e in point.entities.items()
        if name in movable
    }
    arms = [
        SlimArm(
            arm_id=a.arm_id, name=a.name,
            ee_position=[round(float(v), 5) for v in a.ee_pose_xyzw[:3]],
            ee_quat_xyzw=[round(float(v), 5) for v in a.ee_pose_xyzw[3:7]],
            holding=a.holding, contact_sides=a.holding_contact_sides,
        )
        for a in point.arms
    ]
    pairs: set[str] = set()
    for c in point.contacts:
        owners = (c.owner_a, c.owner_b)
        if any(
            o.startswith("arm:") and ":finger" in o or (o.startswith("entity:") and o.split(":", 1)[1] in movable)
            for o in owners
        ):
            pairs.add(" ↔ ".join(sorted(owners)))
    return SlimPoint(step=int(point.step), entities=entities, arms=arms, contacts=sorted(pairs))


class MotionSpanFact(BaseModel):
    span_id: int
    tool: str = ""
    node: str = ""
    arm_id: int = 0
    status: str = ""
    start_step: int = 0
    end_step: int = 0
    request: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    error: str | None = None
    delta: StateDelta
    trajectory: TrajectorySummary = Field(default_factory=TrajectorySummary)
    target_position: list[float] | None = None
    achieved_position: list[float] | None = None
    position_error_m: float | None = None
    grasp: GraspGeometry | None = None
    tracking_deficit_rad: float | None = None
    """How far the arm ended from its trajectory's final waypoint (max joint
    gap, rad). A blocked streamed execution can finish with status ok while the
    arm never arrives. ``None`` when the span carried no joint trajectory."""
    rotation_error_deg: float | None = None
    """How far the hand's orientation ended from the one asked for. Position
    and orientation are lost separately: a hand can arrive within 2 mm and
    close across the wrong axis."""
    reported_residuals: dict[str, float] = Field(default_factory=dict)
    after_state: SlimPoint | None = None
    """Where the movables and hands were when this span ended."""
    goal_states: dict[str, dict[str, Any]] = Field(default_factory=dict)
    """Per graded goal (``object→region``), the family's geometric verdict and
    distance-to-goal at this span's last step: ``{"ok": bool | None,
    "distance_m": float | None}``. Empty for families without a per-step tracker."""


# ------------------------------------------------------------------ the packet


class NodeTraceSummary(BaseModel):
    """One workflow node, compressed from GaP's execution trace."""

    node: str
    kind: str = ""
    status: str = ""
    duration_s: float = 0.0
    error: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
    started_at: float | None = None
    """Wall time the node first started, so per-node units follow execution order."""


class UnitFrame(BaseModel):
    """A still at one feedback unit's boundary, for the ``visual`` form."""

    unit: str
    """The unit key (``episode``, ``span:3``, ``node:grasp_sg.pick``)."""
    when: Literal["before", "after"]
    camera: str
    step: int
    path: str
    """Where the still was written, beside its episode's video."""
    name: str
    """Its file name inside the workspace's ``frames/``, as the feedback cites it."""


class AbortFact(BaseModel):
    """Where and why the graph stopped executing. Outcome evidence: every condition shows it.

    An episode whose graph raised is a different failure from one whose graph
    ran to its end and missed, and the feedback says so even when it shows
    nothing else about execution.
    """

    node: str | None = None
    """The node that raised, when the trace names one."""
    error: str = ""
    """The recorded error's first line."""
    step: int | None = None
    """Control steps the episode had spent when the graph gave up."""
    before_motion: bool = False
    """No motion span was recorded before it: the arm never moved."""
    at_load: bool = False
    """No node ever started: the graph failed to bind or validate."""


class EpisodeFeedback(BaseModel):
    """Everything recorded about one episode. A condition's view decides what is shown."""

    episode_id: int

    # outcome: shown in every condition
    success: bool = False
    steps: int | None = None
    close_kind: str | None = None
    abort: AbortFact | None = None
    """Set when the graph raised instead of finishing: that it died, where, and why."""

    # the evaluator's own bookkeeping: never shown
    seed: int | None = None
    reward: float | None = None
    evaluator_metrics: dict[str, Any] = Field(default_factory=dict)

    # visual
    unit_frames: list[UnitFrame] = Field(default_factory=list)
    """Stills at unit boundaries (``visual`` form only)."""

    # derived from the raw capture
    point_start: PointFacts | None = None
    point_end: PointFacts | None = None
    goal_progress: list[GoalProgress] = Field(default_factory=list)
    """Graded distance-to-goal per goal, in the evaluator's own vocabulary."""
    state_delta: StateDelta | None = None
    motion_spans: list[MotionSpanFact] = Field(default_factory=list)
    grasp_geometry: list[GraspGeometry] = Field(default_factory=list)
    loss_events: list[str] = Field(default_factory=list)
    attitude_tracks: dict[str, dict[str, Any]] = Field(default_factory=dict)
    """Per declared ``axis`` feature (``entity.feature``), read over the whole
    tape: its angle from world up at the start, its peak (with the step and
    node), and at the end. Endpoints cannot tell a body that was stood up and
    fell back from one that was never touched."""

    # the GaP execution trace
    nodes: list[NodeTraceSummary] = Field(default_factory=list)
    graph_error: str | None = None
    graph_traceback: str | None = None

    def first_error_node(self) -> str | None:
        """The node this episode's failure stopped at, or ``None``.

        The node table comes from the trace; the abort fact is outcome
        evidence, so failures still group by the node that raised when the
        table is not shown."""
        first = next((node.node for node in self.nodes if node.error), None)
        if first is None and self.abort is not None:
            first = self.abort.node
        return first


class IterationSummary(BaseModel):
    """One earlier iteration, as the agent reads it in the history section.

    ``change`` is the agent's own account of its edit, rendered as unverified.
    Everything else is derived by the loop: what the policy did (from that
    iteration's packet, see :func:`~asl.feedback.extract.behavior_digest`) and
    how large the edit was. Held-out scores never enter."""

    iteration: int
    train_success_rate: float | None = None
    train_n: int = 0
    change: str = ""
    diff_stats: dict[str, Any] = Field(default_factory=dict)
    accepted: bool = True
    changed: bool = True
    """Whether the agent returned an edited policy at all; the diff counters
    measure size, and an edit they cannot size is still an edit."""
    failure_stages: dict[str, int] = Field(default_factory=dict)
    """Node the graph raised at → failed-episode count; ``(out of steps)``
    counts failures cut off at the step limit and ``(claimed success)`` those
    whose graph finished, in both of which the graph did not raise."""
    failure_errors: dict[str, str] = Field(default_factory=dict)
    """One recorded error message per node the graph raised at."""
    aborted: int = 0
    """Episodes whose graph raised instead of finishing."""
    dominant_error: str = ""
    """``node: error`` of the most frequent failure stage, when it raised."""
    grasp_summary: dict[str, int] = Field(default_factory=dict)
    """Grasp attempts over the batch: ``attempts``, ``on_object`` (the fingers
    met the intended object), ``carried`` (it moved with the hand), ``ejected``."""
    goal_outcomes: dict[str, dict[str, Any]] = Field(default_factory=dict)
    """Per goal (``object→region``), over the failed episodes: median distance
    at the end, closest approach, how many reached the goal geometry and lost
    it, how many were held at the end."""
    attitude_peaks: dict[str, float] = Field(default_factory=dict)
    """Per declared axis (``entity.feature``), the furthest the batch turned it from world up [deg]."""


class Aggregate(BaseModel):
    """Outcome statistics over the batch."""

    n: int = 0
    successes: int = 0
    success_rate: float = 0.0
    episodes_requested: int = 0
    """How many episodes the runner was asked for; 0 when unknown."""
    abort: str | None = None
    """A note when the batch wrote fewer scored rows than were requested."""
    aborted: int = 0
    """Episodes whose graph raised instead of finishing."""
    aborted_at_load: int = 0
    """Of those, the ones in which no node ever started."""
    truncated: int = 0
    """Episodes that ran out of control steps with the task unfinished."""
    abort_nodes: dict[str, int] = Field(default_factory=dict)
    """Node that raised → aborted-episode count, most frequent first."""
    first_graph_error: str | None = None
    """The recorded error of the most frequent abort node, first line."""
    median_steps: float | None = None
    close_kinds: dict[str, int] = Field(default_factory=dict)
    per_episode_success: dict[int, bool] = Field(default_factory=dict)


class FeedbackPacket(BaseModel):
    """One training batch: the full record, or one feedback condition's view of it."""

    schema_version: int = SCHEMA_VERSION
    iteration: int = 0
    task: str = ""
    variant: str = ""
    split: Literal["train"] = "train"
    instruction: str = ""
    aggregate: Aggregate = Field(default_factory=Aggregate)
    episodes: list[EpisodeFeedback] = Field(default_factory=list)
    history: list[IterationSummary] = Field(default_factory=list)
    design: dict[str, Any] | None = None
    """Set on a view (:meth:`view`): the condition's ``{form, spatial, granularity}``."""
    declared_features: dict[str, dict[str, dict]] = Field(default_factory=dict)
    """Entity → its asset-declared parts, in the entity's own frame. Identical
    in every episode, so it is carried once per packet."""

    def view(self, design: Any) -> FeedbackPacket:
        """A copy without the evidence a feedback condition can never show.

        Whole kinds of evidence are dropped here: the evaluator's bookkeeping
        always; world facts without a world form; stills without the visual
        form; node records below ``semantic``. The finer cut (which spatial
        level a fact needs, numbers versus predicates, which unit it belongs
        to) is the renderer's, so a view can still hold facts a condition never
        prints. The record of exactly what the agent read is ``FEEDBACK.md``.
        """
        spec = design.model_dump() if hasattr(design, "model_dump") else dict(design)
        forms = set(spec.get("form") or ())
        world = bool(forms & {"state", "relations"})
        out = self.model_copy(deep=True)
        out.design = spec
        out.aggregate.median_steps = None
        if not world or spec.get("spatial") != "parts":
            out.declared_features = {}
        for episode in out.episodes:
            episode.seed = None
            episode.reward = None
            episode.evaluator_metrics = {}
            if "visual" not in forms:
                episode.unit_frames = []
            if not world:
                episode.point_start = None
                episode.point_end = None
                episode.goal_progress = []
                episode.state_delta = None
                episode.grasp_geometry = []
                episode.loss_events = []
                episode.attitude_tracks = {}
                # A visual-only condition keeps each span's skeleton (tool,
                # node, steps) to label its stills, and none of its measurements.
                episode.motion_spans = (
                    [
                        MotionSpanFact(
                            span_id=s.span_id, tool=s.tool, node=s.node, arm_id=s.arm_id,
                            status=s.status, start_step=s.start_step, end_step=s.end_step,
                            delta=StateDelta(start_step=s.start_step, end_step=s.end_step),
                        )
                        for s in episode.motion_spans
                    ]
                    if "visual" in forms else []
                )
            if spec.get("granularity") != "semantic":
                # Units at motion or episode granularity carry no node names;
                # the policy's own raised error rides ``abort``.
                episode.nodes = []
        return out
