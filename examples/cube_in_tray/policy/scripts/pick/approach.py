import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    grasp: dict
    width: float
    heading_deg: float
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


def _angle(a, b) -> float:
    qa, qb = _wxyz(a), _wxyz(b)
    na = math.sqrt(sum(v * v for v in qa)) or 1.0
    nb = math.sqrt(sum(v * v for v in qb)) or 1.0
    d = abs(sum(i * j for i, j in zip(qa, qb))) / (na * nb)
    return 2.0 * math.acos(min(1.0, d))


def _pose(p, rotation) -> dict:
    return {"position": {"x": p[0], "y": p[1], "z": p[2]}, "rotation": rotation}


def _sides(obb: dict) -> list:
    """(heading_deg, full width) of the box's two horizontal axes."""
    R = _matrix(obb["orientation"])
    ext = _xyz(obb["extent"])
    vertical = max(range(3), key=lambda i: abs(R[2][i]))
    return [(math.degrees(math.atan2(R[1][i], R[0][i])), 2.0 * ext[i])
            for i in range(3) if i != vertical]


def _heading_gap(a: float, b: float) -> float:
    d = (a - b) % 180.0
    return min(d, 180.0 - d)


def _plan(ctx, pose) -> dict:
    try:
        return ctx.tool("motion.plan_joint", pose=pose, orientation="lock")
    except Exception:
        return ctx.tool("motion.plan_joint", pose=pose)


def _joint_travel(plan: dict) -> float:
    wps = (plan.get("trajectory") or {}).get("waypoints") or []
    if len(wps) < 2:
        return 0.0
    a, b = wps[0].get("positions") or [], wps[-1].get("positions") or []
    return sum(abs(float(x) - float(y)) for x, y in zip(a, b))


def run(ctx: NodeContext, cube: str) -> Output:
    """Hover above the cube with the jaws square to its faces, ready to descend."""
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    ws = ctx.tool("robot.describe_workspace")
    hand = ctx.tool("robot.describe_gripper")
    max_width = float(hand.get("max_grasp_width_m") or 0.0)

    g = _xyz(info["grasp_position"])
    if ws.get("surface_z") is not None:
        g[2] = max(g[2], float(ws["surface_z"]) + 0.01)
    # a short standoff: the descent is a slow straight line and the episode has a step budget
    standoff = min(float(ws.get("pregrasp_standoff_m") or 0.10), 0.07)
    hover_z = max(g[2] + standoff, float(info["top_z"]) + 0.04)

    heading = float(info.get("grasp_heading_deg") or 0.0)
    choices = [(heading, float(info.get("grasp_width") or 0.0))]
    try:
        for h, w in _sides(info["obb"]):
            if _heading_gap(h, heading) > 45.0 and (max_width <= 0 or w <= max_width - 0.004):
                choices.append((h, w))  # the other face pair, if the jaws span it
    except Exception:
        pass

    best, tried = None, []
    for rank, (h, w) in enumerate(choices):
        frame = ctx.tool("robot.grasp_frame", close_heading_deg=h)
        for key in ("rotation", "rotation_flipped"):
            rot = frame.get(key)
            if rot is None:
                continue
            hover = _pose([g[0], g[1], hover_z], rot)
            try:
                plan = _plan(ctx, hover)
            except Exception as exc:
                tried.append(f"{h:.0f}deg/{key}: raised {exc}")
                continue
            if not plan.get("trajectory"):
                tried.append(f"{h:.0f}deg/{key}: {plan.get('reason')}")
                continue
            pos_err = float(plan.get("position_error_m") or 0.0)
            rot_err = float(plan.get("rotation_error_rad") or 0.0)
            good = plan.get("planned", True) and pos_err <= 0.01 and rot_err <= 0.08
            cost = _joint_travel(plan) + 0.5 * rank
            if not good:
                cost += 100.0 + 10.0 * pos_err + rot_err
            tried.append(f"{h:.0f}deg/{key}: err {pos_err:.3f}m {rot_err:.3f}rad cost {cost:.2f}")
            if best is None or cost < best[0]:
                best = (cost, plan, hover, rot, h, w)
    if best is None:
        raise RuntimeError("no plan to a hover above the cube: " + "; ".join(tried))

    _, plan, hover, rot, h, w = best
    ctx.tool("robot.execute_trajectory", trajectory=plan["trajectory"])
    pose = ctx.tool("robot.get_ee_pose")["pose"]
    err = math.dist(_xyz(pose["position"]), _xyz(hover["position"]))
    if err > 0.01:
        ctx.tool("robot.go_to_pose_cartesian", pose=hover)
        pose = ctx.tool("robot.get_ee_pose")["pose"]
        err = math.dist(_xyz(pose["position"]), _xyz(hover["position"]))
    if err > 0.03:
        raise RuntimeError(f"the hand stopped {err:.3f} m from the hover above the cube; tried {tried}")

    note = (f"hover err {err:.3f} m, wrist off by {_angle(pose['rotation'], rot):.3f} rad, "
            f"heading {h:.1f} deg, width {w:.3f} m, grasp z {g[2]:.3f}; tried {tried}")
    return {"grasp": _pose(g, rot), "width": w, "heading_deg": h, "note": note}
