from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    retreated: bool
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


def run(ctx: NodeContext, cube: str, clearance: float = 0.06) -> Output:
    """Open the hand (unless it is already wide enough for the cube) and, if it is down near the cube after a failed try, back straight up."""
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    span = float(ctx.tool("robot.describe_gripper").get("span_m") or 0.0)
    width = float(info.get("grasp_width") or 0.0)
    need = min(0.95, (width + 0.03) / span) if span > 0 and width > 0 else 0.9
    if float(ctx.tool("robot.get_gripper").get("position", 0.0)) < need:
        ctx.tool("robot.open_gripper")  # every step counts against the episode budget
    pose = ctx.tool("robot.get_ee_pose")["pose"]
    p = _xyz(pose["position"])
    top = float(info["top_z"])
    if p[2] >= top + clearance:
        return {"retreated": False, "note": f"hand at z={p[2]:.3f}, cube top {top:.3f}"}

    ws = ctx.tool("robot.describe_workspace")
    standoff = float(ws.get("pregrasp_standoff_m") or 0.10)
    up = max(top + standoff, p[2] + 0.05)
    how = _move(ctx, _pose([p[0], p[1], up], pose["rotation"]))
    return {"retreated": True, "note": f"backed up from z={p[2]:.3f} to {up:.3f} ({how})"}
