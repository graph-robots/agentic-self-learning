# SPDX-License-Identifier: Apache-2.0
"""A skill library the agent may build on: discover, admit, document, copy.

A library is a directory holding ``skills/<name>/SKILL.md`` in the Agent
Skills format (YAML front matter with ``name``, ``description`` and an optional
``gap`` block naming ``allowed_tools`` and ``exit_conditions``), with the
skill's scripts beside it; open-robot-skills is one.

A skill is offered only when it can run here: every tool its scripts call,
and every tool it declares, must be in the task's tools file. Advertising one
that cannot run costs the agent a rejected round.

The policy check accepts only ``"skill": "generated"`` subgraphs, so a skill
is reused by reading it and copying what the policy needs into its own
``workflow/scripts/``.
"""

from __future__ import annotations

import ast
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import yaml

__all__ = ["Skill", "admitted", "discover_skills", "library_markdown", "scan_tool_calls", "stage_skills"]


@dataclass(frozen=True)
class Skill:
    """One skill as a run sees it: where it is, what it says, what it calls."""

    name: str
    directory: Path
    description: str
    declared: frozenset[str]
    """``gap.allowed_tools``: what the skill documents."""
    called: frozenset[str]
    """Every literal ``ctx.tool("...")`` name in the skill's Python."""
    dynamic: bool
    """Some call computes its tool name, so the literal scan cannot see it."""
    exits: tuple[str, ...]
    meta: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def needs(self) -> frozenset[str]:
        """Every tool the skill may call or declares."""
        return self.called | self.declared


def scan_tool_calls(directory: Path) -> tuple[frozenset[str], bool]:
    """Literal ``<expr>.tool("name")`` names in every ``.py`` under *directory*, and
    whether any call's name is not a literal.

    A call wrapped in ``try`` counts: the script still makes it, and with the
    tool withheld it fails.
    """
    names: set[str] = set()
    dynamic = False
    for path in sorted(Path(directory).rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text())
        except (SyntaxError, UnicodeDecodeError):
            dynamic = True  # unreadable: nothing about it can be cleared
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            if node.func.attr not in ("tool", "tool_call"):
                continue
            first = node.args[0] if node.args else None
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                names.add(first.value)
            else:
                dynamic = True
    return frozenset(names), dynamic


def _read_skill(skill_md: Path) -> Skill | None:
    text = skill_md.read_text()
    if not text.startswith("---"):
        return None
    try:
        meta = yaml.safe_load(text.split("---", 2)[1]) or {}
    except yaml.YAMLError:
        return None
    gap = meta.get("gap") or {}
    called, dynamic = scan_tool_calls(skill_md.parent)
    return Skill(
        name=str(meta.get("name") or skill_md.parent.name),
        directory=skill_md.parent,
        description=" ".join(str(meta.get("description") or "").split()),
        declared=frozenset(str(t) for t in (gap.get("allowed_tools") or [])),
        called=called,
        dynamic=dynamic,
        exits=tuple(str(e) for e in (gap.get("exit_conditions") or {})),
        meta=meta,
    )


def discover_skills(library: Path) -> list[Skill]:
    """Every skill under ``<library>/skills/*``, by name."""
    seen: dict[str, Skill] = {}
    for skill_md in sorted(Path(library).glob("skills/*/SKILL.md")):
        skill = _read_skill(skill_md)
        if skill is not None and skill.name not in seen:
            seen[skill.name] = skill
    return list(seen.values())


def admitted(skill: Skill, allowed: set[str]) -> bool:
    """A skill can run here when every tool it calls or declares is allowed, and none is computed."""
    return not skill.dynamic and skill.needs <= set(allowed)


def library_markdown(skills: list[Skill], mode: str) -> str:
    """``SKILLS.md`` for the workspace: the admitted skills, as one table."""
    if not skills or mode == "none":
        return ""
    where = (
        "Each one's `SKILL.md` and scripts are in `skills/<name>/` in this directory."
        if mode == "full"
        else "Only their descriptions are given here; their source is not available to you."
    )
    lines = [
        "# Skills",
        "",
        "A **skill** is a documented strategy for one stage of a task: the tools it",
        "uses, the steps it takes and the exits it can end in. These are the skills",
        "whose every tool is in `TOOLS.md`. " + where,
        "",
        "To use one, write it into your own policy: copy or adapt its scripts into",
        '`workflow/scripts/`, keep `"skill": "generated"` on the subgraph, and name',
        "the skill you started from in the subgraph's or the workflow's description.",
        "A stage often has more than one strategy; a strategy that declines can",
        "route to the next instead of ending the episode.",
        "",
        "| skill | tools it uses | exits | what it is for |",
        "|---|---|---|---|",
        *(
            f"| `{s.name}` | {', '.join(f'`{t}`' for t in sorted(s.needs)) or '—'} | "
            f"{', '.join(f'`{e}`' for e in s.exits) or '—'} | {s.description} |"
            for s in sorted(skills, key=lambda s: s.name)
        ),
    ]
    return "\n".join(lines) + "\n"


def stage_skills(library: Path | None, mode: str, allowed: set[str], workspace: Path) -> list[Skill]:
    """Write the workspace's ``SKILLS.md`` (and, in ``full``, ``skills/<name>/``); return the skills offered."""
    workspace = Path(workspace)
    shutil.rmtree(workspace / "skills", ignore_errors=True)
    (workspace / "SKILLS.md").unlink(missing_ok=True)
    if library is None or mode == "none":
        return []
    skills = [s for s in discover_skills(library) if admitted(s, allowed)]
    text = library_markdown(skills, mode)
    if text:
        (workspace / "SKILLS.md").write_text(text)
    if mode == "full":
        for skill in skills:
            shutil.copytree(
                skill.directory,
                workspace / "skills" / skill.directory.name,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
    return skills
