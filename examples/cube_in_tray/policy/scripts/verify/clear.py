import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    hand_to_cube_m: float
    note: str


def _xyz(v) -> list:
    if isinstance(v, dict):
        return [float(v["x"]), float(v["y"]), float(v["z"])]
    return [float(a) for a in list(v)[:3]]


def _pose(p, rotation) -> dict:
    return {"position": {"x": p[0], "y": p[1], "z": p[2]}, "rotation": rotation}


def _move(ctx, pose) -> str:
    """Straight line holding the wrist, else a joint-space plan; the slow servoed line is last."""
    why = []
    for extra in ({"allow_start_contact": True, "allow_goal_contact": True}, {}):
        try:
            plan = ctx.tool("motion.plan_linear", end=pose, orientation="lock", **extra)
            if plan.get("planned", True) and plan.get("trajectory"):
                ctx.tool("robot.execute_trajectory", trajectory=plan["trajectory"])
                return "linear"
            why.append(f"plan_linear: {plan.get('reason')}")
        except Exception as exc:
            why.append(f"plan_linear raised: {exc}")
    try:
        plan = ctx.tool("motion.plan_joint", pose=pose, orientation="lock")
        if plan.get("planned", True) and plan.get("trajectory") and float(plan.get("position_error_m") or 0.0) <= 0.01:
            ctx.tool("robot.execute_trajectory", trajectory=plan["trajectory"])
            return "joint after " + "; ".join(why)
        why.append(f"plan_joint: {plan.get('reason')} err {plan.get('position_error_m')}")
    except Exception as exc:
        why.append(f"plan_joint raised: {exc}")
    ctx.tool("robot.go_to_pose_cartesian", pose=pose)
    return "cartesian after " + "; ".join(why)


def run(ctx: NodeContext, cube: str, above_top: float = 0.04) -> Output:
    """Get the whole robot away from the placed cube: let go, lift off it, and send the arm home."""
    notes = []
    if float(ctx.tool("robot.get_gripper").get("position", 1.0)) < 0.6:
        ctx.tool("robot.open_gripper")
        notes.append("opened")

    pose = ctx.tool("robot.get_ee_pose")["pose"]
    p = _xyz(pose["position"])
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    c, top = _xyz(info["obb"]["center"]), float(info["top_z"])
    if p[2] < top + above_top and math.hypot(p[0] - c[0], p[1] - c[1]) < 0.08:
        # straight up first, so the swing home cannot sweep the fingers through the cube
        notes.append("lifted off: " + _move(ctx, _pose([p[0], p[1], p[2] + 0.05], pose["rotation"])))

    ctx.tool("robot.go_home")
    p = _xyz(ctx.tool("robot.get_ee_pose")["pose"]["position"])
    c = _xyz(ctx.tool("sim.get_object_pose", object_name=cube)["pose"]["position"])
    far = math.dist(p, c)
    notes.append(f"home, hand {far:.3f} m from cube")
    return {"hand_to_cube_m": far, "note": "; ".join(notes)}
