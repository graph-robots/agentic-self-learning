import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    over_tray: dict
    note: str


def _xyz(v) -> list:
    if isinstance(v, dict):
        return [float(v["x"]), float(v["y"]), float(v["z"])]
    return [float(a) for a in list(v)[:3]]


def _wxyz(q) -> list:
    if isinstance(q, dict):
        return [float(q["w"]), float(q["x"]), float(q["y"]), float(q["z"])]
    return [float(a) for a in list(q)[:4]]


def _matrix(o) -> list:
    """3x3 rotation from a wxyz quaternion (dict or list) or a matrix."""
    if isinstance(o, (list, tuple)) and len(o) == 3 and isinstance(o[0], (list, tuple)):
        return [[float(a) for a in row] for row in o]
    if isinstance(o, (list, tuple)) and len(o) == 9:
        return [[float(a) for a in o[r * 3:r * 3 + 3]] for r in range(3)]
    w, x, y, z = _wxyz(o)
    n = math.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ]


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


def _holding(ctx, cube: str, floor: float) -> str:
    """Raise unless the cube is up in the air between the fingers."""
    p = _xyz(ctx.tool("robot.get_ee_pose")["pose"]["position"])
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    c = _xyz(info["obb"]["center"])
    grip = float(ctx.tool("robot.get_gripper").get("position", 1.0))
    off = math.hypot(p[0] - c[0], p[1] - c[1])
    bottom = float(info["bottom_z"])
    if grip < 0.02:
        raise RuntimeError(f"the fingers are shut ({grip:.3f}): the cube is gone")
    if off > 0.06:
        raise RuntimeError(f"the cube is {off:.3f} m sideways from the hand: dropped")
    if bottom < floor + 0.01:
        raise RuntimeError(f"the cube bottom is at {bottom:.3f}, down on the surface: dropped")
    return f"grip {grip:.3f}, cube {off:.3f} m off-axis, bottom {bottom:.3f}"


def run(ctx: NodeContext, cube: str, tray: str, margin: float = 0.025) -> Output:
    """Carry the held cube, bottom clear of the tray walls, until it is over the tray centre."""
    obb = ctx.tool("sim.get_region_obb", region_name=tray)["obb"]
    centre, ext, R = _xyz(obb["center"]), _xyz(obb["extent"]), _matrix(obb["orientation"])
    half = sum(abs(R[2][i]) * ext[i] for i in range(3))
    floor = centre[2] - half
    clear = floor + min(max(2.0 * half, 0.03), 0.10) + margin
    before = _holding(ctx, cube, floor)

    pose = ctx.tool("robot.get_ee_pose")["pose"]
    p, rot = _xyz(pose["position"]), pose["rotation"]
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    c, bottom = _xyz(info["obb"]["center"]), float(info["bottom_z"])

    z = max(p[2], p[2] + clear - bottom)
    if z > p[2] + 0.01:
        _move(ctx, _pose([p[0], p[1], z], rot))
    # put the cube's centre, not the hand's, over the tray centre
    over = _pose([centre[0] + p[0] - c[0], centre[1] + p[1] - c[1], z], rot)
    how = _move(ctx, over)
    after = _holding(ctx, cube, floor)
    return {"over_tray": over, "note": f"{how}; carry z {z:.3f}; before: {before}; after: {after}"}
