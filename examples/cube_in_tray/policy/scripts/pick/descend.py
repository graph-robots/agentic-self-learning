import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    error_m: float
    note: str


def _xyz(v) -> list:
    if isinstance(v, dict):
        return [float(v["x"]), float(v["y"]), float(v["z"])]
    return [float(a) for a in list(v)[:3]]


def _straight(ctx, pose, speed_scale: float) -> str:
    """Straight line holding the wrist; the servoed Cartesian line is the fallback."""
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
    ctx.tool("robot.go_to_pose_cartesian", pose=pose, speed_scale=speed_scale)
    return "cartesian after " + "; ".join(why)


def _cube(ctx, cube: str) -> list:
    return _xyz(ctx.tool("sim.get_object_pose", object_name=cube)["pose"]["position"])


def run(ctx: NodeContext, cube: str, grasp: dict) -> Output:
    """Lower the open hand straight down around the cube."""
    start = _cube(ctx, cube)
    goal = _xyz(grasp["position"])
    how = _straight(ctx, grasp, 0.5)
    p = _xyz(ctx.tool("robot.get_ee_pose")["pose"]["position"])
    if math.dist(p, goal) > 0.01:
        ctx.tool("robot.go_to_pose_cartesian", pose=grasp, speed_scale=0.5)
        p = _xyz(ctx.tool("robot.get_ee_pose")["pose"]["position"])
        how += " + cartesian touch-up"

    now = _cube(ctx, cube)
    shove = math.hypot(now[0] - start[0], now[1] - start[1])
    high = p[2] - goal[2]
    err = math.dist(p, goal)
    if high > 0.02:
        raise RuntimeError(f"the hand stopped {high:.3f} m above the grasp (fingers on the cube?), {how}")
    if shove > 0.03:
        raise RuntimeError(f"the descent pushed the cube {shove:.3f} m, {how}")
    return {"error_m": err, "note": f"{how}; err {err:.3f} m, cube pushed {shove:.3f} m"}
