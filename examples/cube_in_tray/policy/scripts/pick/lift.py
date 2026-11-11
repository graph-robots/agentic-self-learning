import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    lifted_m: float
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


def _clear_bottom(ctx, tray: str, margin: float = 0.025) -> float:
    """The height the cube's bottom must keep to pass over the tray's walls."""
    obb = ctx.tool("sim.get_region_obb", region_name=tray)["obb"]
    centre, ext, R = _xyz(obb["center"]), _xyz(obb["extent"]), _matrix(obb["orientation"])
    half = sum(abs(R[2][i]) * ext[i] for i in range(3))
    wall = min(max(2.0 * half, 0.03), 0.10)
    return centre[2] - half + wall + margin


def _cube(ctx, cube: str) -> list:
    return _xyz(ctx.tool("sim.get_object_pose", object_name=cube)["pose"]["position"])


def run(ctx: NodeContext, cube: str, tray: str, min_rise: float = 0.06) -> Output:
    """Lift straight up just high enough to clear the tray walls, and check the cube came along."""
    pose = ctx.tool("robot.get_ee_pose")["pose"]
    p0, rot = _xyz(pose["position"]), pose["rotation"]
    c0 = _cube(ctx, cube)
    bottom = float(ctx.tool("sim.get_object_obb", object_name=cube)["bottom_z"])

    # the hand-to-cube-bottom offset holds while gripped, so this puts the bottom at the clearance
    z = max(p0[2] + min_rise, p0[2] + _clear_bottom(ctx, tray) - bottom)
    how = _move(ctx, _pose([p0[0], p0[1], z], rot))

    p = _xyz(ctx.tool("robot.get_ee_pose")["pose"]["position"])
    c = _cube(ctx, cube)
    hand_rise, cube_rise = p[2] - p0[2], c[2] - c0[2]
    if hand_rise < 0.01:
        raise RuntimeError(f"the hand only rose {hand_rise:.3f} m ({how})")
    if cube_rise < 0.5 * hand_rise:
        raise RuntimeError(f"the hand rose {hand_rise:.3f} m but the cube {cube_rise:.3f} m: slipped")
    grip = float(ctx.tool("robot.get_gripper").get("position", 1.0))
    if grip < 0.02:
        raise RuntimeError(f"the fingers closed to {grip:.3f} while lifting: dropped")
    return {"lifted_m": cube_rise,
            "note": f"{how}; aimed z {z:.3f}, hand rose {hand_rise:.3f}, cube {cube_rise:.3f}, grip {grip:.3f}"}
