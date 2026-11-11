from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    cube_z: float
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


def run(ctx: NodeContext, cube: str, retreat: float = 0.05) -> Output:
    """Open the hand and back a short way straight up, clear of the cube."""
    opened = ctx.tool("robot.open_gripper")
    pose = ctx.tool("robot.get_ee_pose")["pose"]
    p = _xyz(pose["position"])
    how = _move(ctx, _pose([p[0], p[1], p[2] + retreat], pose["rotation"]))
    c = _xyz(ctx.tool("sim.get_object_pose", object_name=cube)["pose"]["position"])
    return {"cube_z": c[2], "note": f"opened to {opened.get('position')}; {how}; cube at {c}"}
