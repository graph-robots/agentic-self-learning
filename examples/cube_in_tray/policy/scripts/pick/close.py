from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    position: float
    note: str


def run(ctx: NodeContext, width: float) -> Output:
    """Close fully (the strongest squeeze) and fail if the fingers met with nothing between."""
    closed = ctx.tool("robot.close_gripper")
    pos = float(closed.get("position", 0.0))
    span = float(ctx.tool("robot.describe_gripper").get("span_m") or 0.0)
    expected = width / span if span > 0 and width > 0 else 0.0
    floor = min(0.15, max(0.02, 0.35 * expected))
    if pos < floor:
        raise RuntimeError(f"the fingers closed to {pos:.3f} (a {width:.3f} m cube should leave ~{expected:.3f}): missed")
    return {"position": pos, "note": f"closed to {pos:.3f}, expected ~{expected:.3f}"}
