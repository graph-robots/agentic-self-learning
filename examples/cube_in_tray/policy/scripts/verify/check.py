import math
from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    inside: bool
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


def run(ctx: NodeContext, cube: str, tray: str, settle_steps: int = 0) -> Output:
    """Fail unless the cube's centre is over the tray and it rests low in it (the trip home let it settle)."""
    if settle_steps > 0:
        ctx.tool("robot.wait_steps", steps=settle_steps)
    info = ctx.tool("sim.get_object_obb", object_name=cube)
    c = _xyz(info["obb"]["center"])
    obb = ctx.tool("sim.get_region_obb", region_name=tray)["obb"]
    centre, ext, R = _xyz(obb["center"]), _xyz(obb["extent"]), _matrix(obb["orientation"])

    d = [c[i] - centre[i] for i in range(3)]
    local = [sum(R[r][i] * d[r] for r in range(3)) for i in range(3)]  # R^T d
    vertical = max(range(3), key=lambda i: abs(R[2][i]))
    over = all(abs(local[i]) <= ext[i] + 0.005 for i in range(3) if i != vertical)
    top = centre[2] + sum(abs(R[2][i]) * ext[i] for i in range(3))
    low = float(info["bottom_z"]) <= top + 0.03

    note = (f"cube centre {[round(v, 3) for v in c]} in tray frame {[round(v, 3) for v in local]}, "
            f"half extents {[round(v, 3) for v in ext]}, bottom {float(info['bottom_z']):.3f} vs region top {top:.3f}")
    if not (over and low):
        raise RuntimeError(f"the cube is not in the tray: {note}")
    return {"inside": True, "note": note}
