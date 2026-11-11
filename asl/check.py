# SPDX-License-Identifier: Apache-2.0
"""Static checks on a policy before it runs.

1. gap's own validator (schema, dataflow, routing), with no script imported.
   gap imports a script to read its ``run()`` signature, which runs the
   script's top-level code; here that import is refused, so the check never
   executes the policy. gap reports a script it cannot read as a warning,
   which this check drops, so refusing the import costs no error.
2. Every tool the policy calls is on the allowlist, with argument names the tool
   declares. Tools are found in ``workflow.json`` tool nodes and recovery steps,
   and in every referenced script's ``ctx.tool("name", ...)`` calls, whose name
   must be a literal string.
3. Every subgraph is ``"skill": "generated"``, and every script lives under
   the policy's directory: a policy carries its own code. A named skill would
   be resolved from a registry at run time, out of sight of this check.

:func:`edit_size` measures how much one policy differs from the previous one,
for the feedback's history table.

``python -m asl.check WORKFLOW_DIR --tools tools.json`` prints the problems and
exits 1 when there are any. The agent's ``validate.sh`` runs exactly this.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

__all__ = ["check_workflow", "edit_size", "load_tools"]


def load_tools(path: Path) -> dict[str, set[str]]:
    """``{tool name: its parameter names}`` from a tools file."""
    doc = json.loads(Path(path).read_text())
    return {t["name"]: {p["name"] for p in t.get("params") or []} for t in doc["tools"]}


def _gap_issues(workflow_dir: Path) -> list[str]:
    try:
        from gap.runtime import validate as gap_validate
        from gap.runtime.workflow import load_workflow
    except ImportError as exc:  # pragma: no cover - gap is a dependency
        return [f"CHECK NOT RUN: graph-as-policy is not importable ({exc})"]
    try:
        wf = load_workflow(workflow_dir / "workflow.json")
    except Exception as exc:  # noqa: BLE001 - any load failure is the policy's
        return [f"workflow failed to load: {type(exc).__name__}: {exc}"]
    importer = gap_validate._import_script_for_validation
    gap_validate._import_script_for_validation = _not_imported
    try:
        issues = gap_validate.validate_workflow(wf, agent_registry=None, skill_registry=None, tool_registry=None)
    except Exception as exc:  # noqa: BLE001
        return [f"validator crashed: {type(exc).__name__}: {exc}"]
    finally:
        gap_validate._import_script_for_validation = importer
    return [str(i) for i in issues if getattr(i, "severity", "error") == "error"]


def _not_imported(path: Path, node_id: str) -> None:
    """Stands in for gap's script import: a policy's code runs only when the policy runs."""
    raise ValueError(f"{Path(path).name} is not imported by the check")


def _calls(doc: dict) -> tuple[list[tuple[str, str, set[str]]], list[str]]:
    """Tool calls ``(where, tool, argument names)`` and script paths named by a workflow."""
    calls: list[tuple[str, str, set[str]]] = []
    scripts: list[str] = []

    def nodes(where: str, table: Any) -> None:
        for name, node in _items(table):
            if not isinstance(node, dict):
                continue
            kind = node.get("type")
            if kind == "tool":
                calls.append((f"{where}{name}", str(node.get("tool")), _keys(node.get("inputs"))))
            elif kind in ("script", "router") and node.get("script"):
                scripts.append(str(node["script"]))
            recovery = node.get("recovery")
            for step in recovery if isinstance(recovery, list) else []:
                if isinstance(step, dict):
                    calls.append((f"{where}{name} recovery", str(step.get("tool")), _keys(step.get("inputs"))))

    nodes("", doc.get("nodes"))
    for sg_name, sg in _items(doc.get("subgraphs")):
        if isinstance(sg, dict):
            nodes(f"{sg_name}.", sg.get("nodes"))
    return calls, scripts


def _items(table: Any) -> list[tuple[str, Any]]:
    """A JSON object's items; nothing for anything else, whose shape gap's validator reports."""
    return list(table.items()) if isinstance(table, dict) else []


def _keys(table: Any) -> set[str]:
    return set(table) if isinstance(table, dict) else set()


def _script_calls(path: Path) -> tuple[list[tuple[str, str | None, set[str] | None]], str | None]:
    """``ctx.tool`` calls in one script: ``(line, name or None if dynamic, keywords or None if **kwargs)``."""
    try:
        tree = ast.parse(path.read_text(), filename=str(path))
    except SyntaxError as exc:
        return [], f"{path.name}:{exc.lineno}: syntax error: {exc.msg}"
    found: list[tuple[str, str | None, set[str] | None]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "tool"):
            continue
        first: Any = node.args[0] if node.args else next((k.value for k in node.keywords if k.arg == "name"), None)
        name = first.value if isinstance(first, ast.Constant) and isinstance(first.value, str) else None
        keywords = (
            None if any(k.arg is None for k in node.keywords) else {k.arg for k in node.keywords if k.arg != "name"}
        )
        found.append((f"{path.name}:{node.lineno}", name, keywords))
    return found, None


def check_workflow(workflow_dir: Path, tools: dict[str, set[str]], *, run_gap: bool = True) -> list[str]:
    """Every problem with the policy at *workflow_dir*; ``[]`` when it may run."""
    workflow_dir = Path(workflow_dir)
    path = workflow_dir / "workflow.json"
    if not path.is_file():
        return [f"no workflow.json in {workflow_dir}"]
    try:
        doc = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return [f"workflow.json is not JSON: {exc}"]
    if not isinstance(doc, dict):
        return [f"workflow.json must be a JSON object, got {type(doc).__name__}"]
    errors = _gap_issues(workflow_dir) if run_gap else []

    def judge(where: str, tool: str | None, args: set[str] | None) -> None:
        if tool is None:
            errors.append(f"{where}: ctx.tool needs a literal tool name, not an expression")
        elif tool not in tools:
            errors.append(f"{where}: `{tool}` is not an allowed tool (see TOOLS.md)")
        elif args is not None:
            unknown = sorted(args - tools[tool])
            if unknown:
                errors.append(f"{where}: `{tool}` takes no argument(s) {unknown}; it takes {sorted(tools[tool])}")

    for sg_name, sg in _items(doc.get("subgraphs")):
        label = sg.get("skill", "generated") if isinstance(sg, dict) else "generated"
        if label != "generated":
            errors.append(
                f"subgraph {sg_name}: \"skill\": {json.dumps(label)} names a registry skill; use \"generated\" "
                "and copy the skill's scripts into workflow/scripts/"
            )

    calls, scripts = _calls(doc)
    for where, tool, args in calls:
        judge(where, tool, args)
    for script in dict.fromkeys(scripts):
        file = workflow_dir / script
        if not _inside(workflow_dir, script):
            errors.append(f"script {script} is outside the policy's directory; copy it into workflow/scripts/")
            continue
        if not file.is_file():
            errors.append(f"script {script} is referenced but does not exist")
            continue
        found, problem = _script_calls(file)
        if problem:
            errors.append(problem)
        for where, tool, args in found:
            judge(where, tool, args)
    return errors


def _inside(workflow_dir: Path, script: str) -> bool:
    """Whether *script*, as the workflow names it, is a file under the policy's own directory."""
    if Path(script).is_absolute():
        return False
    return (Path(workflow_dir) / script).resolve().is_relative_to(Path(workflow_dir).resolve())


def _node_ids(workflow: dict) -> set[str]:
    out = {f"nodes.{n}" for n, _ in _items(workflow.get("nodes"))}
    for sg_name, sg in _items(workflow.get("subgraphs")):
        if isinstance(sg, dict):
            out.update(f"{sg_name}.{n}" for n, _ in _items(sg.get("nodes")))
    return out


def _edges(scope: str, graph: dict) -> set[str]:
    out = set()
    edges = graph.get("edges")
    for edge in edges if isinstance(edges, list) else []:
        if isinstance(edge, list | tuple) and len(edge) == 2:
            out.add(f"{scope}:{edge[0]}->{edge[1]}")
    for src, spec in _items(graph.get("conditional_edges")):
        for value, dst in _items(spec.get("mapping") if isinstance(spec, dict) else None):
            out.add(f"{scope}:{src}-[{value}]->{dst}")
    return out


def _edge_set(workflow: dict) -> set[str]:
    out = _edges("top", workflow)
    for sg_name, sg in _items(workflow.get("subgraphs")):
        if isinstance(sg, dict):
            out |= _edges(sg_name, sg)
    return out


def _binding_map(workflow: dict) -> dict[str, str]:
    """Every node input and subgraph input/output binding, addressed and rendered.

    Repointing one ``$ref`` is the smallest decisive edit there is, and node,
    edge and line counts all miss it.
    """
    out: dict[str, str] = {}

    def _record(scope: str, mapping: Any) -> None:
        for key, value in _items(mapping):
            out[f"{scope}.{key}"] = json.dumps(value, sort_keys=True, default=str)

    def _from_nodes(nodes: Any, scope: str) -> None:
        for node_name, node in _items(nodes):
            if isinstance(node, dict):
                _record(f"{scope}.{node_name}.inputs", node.get("inputs"))

    _from_nodes(workflow.get("nodes"), "nodes")
    for sg_name, sg in _items(workflow.get("subgraphs")):
        if not isinstance(sg, dict):
            continue
        _from_nodes(sg.get("nodes"), f"{sg_name}.nodes")
        _record(f"{sg_name}.outputs", sg.get("outputs"))
        _record(f"{sg_name}.inputs", sg.get("inputs"))
    return out


def _files(root: Path) -> dict[str, bytes]:
    if not Path(root).is_dir():
        return {}
    return {
        str(p.relative_to(root)): p.read_bytes()
        for p in sorted(Path(root).rglob("*"))
        if p.is_file() and "__pycache__" not in p.parts
    }


def edit_size(prev_dir: Path, new_dir: Path) -> dict[str, int]:
    """How the policy at *new_dir* differs from the one at *prev_dir*: graph, dataflow, files, lines."""
    def workflow(d: Path) -> dict:
        try:
            doc = json.loads((Path(d) / "workflow.json").read_text())
        except (OSError, json.JSONDecodeError):
            return {}
        return doc if isinstance(doc, dict) else {}

    prev_wf, new_wf = workflow(prev_dir), workflow(new_dir)
    prev, new = _files(prev_dir), _files(new_dir)
    prev_nodes, new_nodes = _node_ids(prev_wf), _node_ids(new_wf)
    prev_edges, new_edges = _edge_set(prev_wf), _edge_set(new_wf)
    prev_bindings, new_bindings = _binding_map(prev_wf), _binding_map(new_wf)
    scripts = {k for k in prev.keys() & new.keys() if k.endswith(".py") and prev[k] != new[k]}

    def loc(files: dict[str, bytes]) -> int:
        return sum(len(v.decode(errors="replace").splitlines()) for k, v in files.items() if k.endswith(".py"))

    return {
        "nodes_added": len(new_nodes - prev_nodes),
        "nodes_removed": len(prev_nodes - new_nodes),
        "edges_added": len(new_edges - prev_edges),
        "edges_removed": len(prev_edges - new_edges),
        "bindings_changed": len(
            {k for k in prev_bindings.keys() | new_bindings.keys() if prev_bindings.get(k) != new_bindings.get(k)}
        ),
        "scripts_changed": len(scripts),
        "files_added": len(new.keys() - prev.keys()),
        "files_removed": len(prev.keys() - new.keys()),
        "loc_delta": loc(new) - loc(prev),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workflow_dir", type=Path)
    parser.add_argument("--tools", type=Path, required=True)
    args = parser.parse_args(argv)
    errors = check_workflow(args.workflow_dir, load_tools(args.tools))
    if errors:
        print("\n".join(f"ERROR {e}" for e in errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
