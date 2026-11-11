from typing import TypedDict

from gap import NodeContext


class Output(TypedDict):
    cube: str
    tray: str
    summary: str


def _tokens(*parts) -> list:
    text = " ".join(str(p or "") for p in parts).lower()
    for sep in "_-./:,()[]":
        text = text.replace(sep, " ")
    return text.split()


def _cube_score(obj: dict) -> int:
    toks = _tokens(obj.get("name"), obj.get("category"))
    joined = "".join(toks)
    score = 0
    if "red" in toks:
        score += 4
    elif joined.startswith("red") or "redcube" in joined or "redblock" in joined:
        score += 3
    if "cube" in joined:
        score += 2
    elif "block" in toks:
        score += 1
    return score


def _tray_score(region: dict) -> int:
    toks = _tokens(region.get("name"), region.get("frame"))
    if "tray" in "".join(toks):
        return 2
    if any(t in ("bin", "basket", "container", "box") for t in toks):
        return 1
    return 0


def _best(items: list, score, what: str) -> str:
    names = [i.get("name") for i in items]
    if not items:
        raise RuntimeError(f"no {what} candidates in the scene")
    ranked = sorted(items, key=score, reverse=True)
    top = score(ranked[0])
    if top == 0 and len(ranked) > 1:
        raise RuntimeError(f"nothing looks like the {what}: {names}")
    if len(ranked) > 1 and score(ranked[1]) == top:
        tied = [i.get("name") for i in ranked if score(i) == top]
        raise RuntimeError(f"cannot tell which is the {what}: {tied} (all: {names})")
    return str(ranked[0]["name"])


def run(ctx: NodeContext) -> Output:
    objects = ctx.tool("sim.list_objects").get("objects") or []
    regions = ctx.tool("sim.list_regions").get("regions") or []

    movable = [o for o in objects if not o.get("static")] or objects
    cube = _best(movable, _cube_score, "red cube")
    tray = _best(regions, _tray_score, "tray")

    info = ctx.tool("sim.get_object_obb", object_name=cube)
    region = ctx.tool("sim.get_region_obb", region_name=tray)
    ws = ctx.tool("robot.describe_workspace")
    hand = ctx.tool("robot.describe_gripper")

    summary = (
        f"objects={[(o.get('name'), o.get('category'), o.get('static')) for o in objects]} "
        f"regions={[(r.get('name'), r.get('frame')) for r in regions]} "
        f"cube={cube} obb={info.get('obb')} grasp_position={info.get('grasp_position')} "
        f"heading={info.get('grasp_heading_deg')} width={info.get('grasp_width')} "
        f"fits={info.get('fits_gripper')} top_z={info.get('top_z')} bottom_z={info.get('bottom_z')} "
        f"tray={tray} obb={region.get('obb')} "
        f"workspace={ {k: ws.get(k) for k in ('surface_z', 'transport_z', 'align_clearance_m', 'pregrasp_standoff_m', 'margin_m')} } "
        f"gripper={ {k: hand.get(k) for k in ('span_m', 'min_grasp_width_m', 'max_grasp_width_m', 'kind')} }"
    )
    return {"cube": cube, "tray": tray, "summary": summary}
