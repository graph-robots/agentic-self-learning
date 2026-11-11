# SPDX-License-Identifier: Apache-2.0
"""One run, as one YAML document.

Relative paths in the document are read against the document's own directory,
so an example's config can name its task root and tool file beside it. A
document may name a ``base`` document, which it overlays key by key; paths in
each document are read against that document's directory.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

__all__ = [
    "AgentConfig",
    "Config",
    "ExecutionConfig",
    "FeedbackConfig",
    "LoopConfig",
    "SkillsConfig",
    "load_config",
]

DEFAULT_CLAUDE_MODEL = "claude-opus-5-5"


class AgentConfig(BaseModel):
    """The coding agent: one headless session, resumed across iterations."""

    kind: Literal["claude_code", "codex"] = "claude_code"
    """``claude_code`` runs ``claude -p``; ``codex`` runs ``codex exec``. Both work in the same workspace."""
    model: str = ""
    """Empty means Claude Opus 5.5 for ``claude_code`` and the CLI's own default for ``codex``."""
    max_turns: int = 80
    """``claude_code`` only."""
    thinking_tokens: int = 0
    """``claude_code`` only: ``MAX_THINKING_TOKENS`` for the session; 0 leaves the CLI's default."""
    reasoning_effort: str = ""
    """``codex`` only: ``model_reasoning_effort`` (``low``, ``medium``, ``high``, ``xhigh``); empty leaves the CLI's."""
    env: dict[str, str] = Field(default_factory=dict)
    """Extra environment for the session, ``$VAR`` expanded when it starts and recorded unexpanded.
    For example an Anthropic-compatible endpoint: ``ANTHROPIC_BASE_URL`` and ``ANTHROPIC_AUTH_TOKEN: $MY_KEY``."""
    claude_binary: str = "claude"
    codex_binary: str = "codex"
    codex_sandbox: Literal["read-only", "workspace-write", "danger-full-access"] = "workspace-write"
    """``codex`` only: the session's sandbox. ``workspace-write`` limits writes, not reads; see docs/guide/agents.md."""
    allowed_tools: str = "Read,Edit,Write,Grep,Glob,Bash(./validate.sh:*)"
    """``claude_code`` only: what the session may use. File work needs no shell; the one command is the validator.
    Claude Code also runs read-only shell commands (``ls``, ``cat``, ``grep``, ...) without asking."""
    timeout_s: float = 7200.0

    @model_validator(mode="after")
    def _default_model(self) -> AgentConfig:
        if not self.model and self.kind == "claude_code":
            self.model = DEFAULT_CLAUDE_MODEL
        return self


class FeedbackConfig(BaseModel):
    """What the agent reads after each training batch: one feedback condition.

    The default is the condition the paper found most useful. ``form`` is what
    simulation feedback the agent gets beyond the outcome (always shown:
    success, steps, how each episode ended, the error the graph raised):
    ``visual`` stills, ``state`` numbers, ``relations`` predicates; ``[]`` is
    the outcome only. ``spatial`` is how space is written: ``positions`` (world
    xyz of whole objects), ``frames`` (+ orientations and object-own axes),
    ``parts`` (+ the assets' declared parts). ``granularity`` is when: once
    per ``episode``, per ``motion`` (every tool call that stepped the
    simulation) or per ``semantic`` step (each node of the agent's workflow,
    under its own names). See docs/guide/feedback.md.
    """

    form: list[Literal["visual", "state", "relations"]] = Field(default_factory=lambda: ["state", "relations"])
    spatial: Literal["positions", "frames", "parts"] = "parts"
    granularity: Literal["episode", "motion", "semantic"] = "semantic"
    max_episodes: int = 6
    """Episodes rendered in full: one per distinct way the batch failed, then one success."""
    max_frames: int = 16
    """``visual`` only: stills per batch, across all cameras, spent around the first failure."""
    cameras: list[str] = Field(default_factory=list)
    """``visual`` only: cameras the stills come from; empty picks a scene camera and a wrist camera."""

    @field_validator("form")
    @classmethod
    def _unique_forms(cls, v: list[str]) -> list[str]:
        return [f for f in ("visual", "state", "relations") if f in set(v)]


class SkillsConfig(BaseModel):
    """A library of skills in the Agent Skills format the agent may build on.

    ``path`` holds ``skills/<name>/SKILL.md`` (for example a clone of
    open-robot-skills). A skill is offered only when every tool its scripts
    call is in the task's tools file. ``listed`` gives the agent each skill's
    name, description and tools without its source; ``full`` also copies each
    skill into the workspace as ``skills/<name>/``. See docs/guide/skills.md.
    """

    path: Path | None = None
    mode: Literal["none", "listed", "full"] = "none"

    @model_validator(mode="after")
    def _needs_a_path(self) -> SkillsConfig:
        if self.mode != "none" and self.path is None:
            raise ValueError(f"skills.mode {self.mode!r} needs skills.path")
        return self


class LoopConfig(BaseModel):
    iterations: int = 4
    """Policies scored on train, counting the first one the agent writes."""
    eval_every: int = 2
    """Score the held-out episodes every this many iterations, and always at the first and the last."""
    perfect_streak: int = 2
    """Stop after this many train batches in a row with every episode a success."""
    max_usd: float = 15.0
    """Stop before an iteration once the agent has cost this much. A Codex session reports no dollars."""
    fix_rounds: int = 2
    """Times a rejected policy goes back to the agent with the errors before the round gives up."""


class ExecutionConfig(BaseModel):
    """How RoboSimStudio runs the graph."""

    device: str = "cuda:0"
    gpu: int | None = None
    """Sets CUDA_VISIBLE_DEVICES for the runner; ``None`` leaves it alone."""
    perception: str = "oracle"
    motion: str = "osc"
    settle_steps: int = 60
    """Control steps the simulation keeps running after the graph finishes, so the evaluator scores a settled scene."""
    max_steps: int = 0
    """Control steps per episode; 0 is the task's own budget."""
    renderer: str = "tiled"
    """Camera renderer for recorded video (``asl-rollout``, and training batches under the visual form)."""
    bus_timeout: float = 900.0
    timeout_s: float = 3600.0
    """Wall-clock limit for one batch of episodes."""


class Config(BaseModel):
    name: str
    task: str
    """``suite/variant`` of the task document."""
    task_root: Path
    instruction: str
    train_episodes: str = "0:6"
    eval_episodes: str = "20:26"
    """Held-out episode ids. Scored, recorded, never shown to the agent."""
    tools: Path
    """JSON list of the tools the policy may call, with their parameters."""
    rss_repo: Path | None = None
    """RoboSimStudio checkout holding ``scripts/bench_run.py``; defaults to ``$ROBOSIMSTUDIO_REPO``."""
    out_root: Path = Path("outputs")
    off_limits: list[Path] = Field(default_factory=list)
    """More paths the agent's file tools may not read, beside the run directory, the task root and the output root.
    A rule for the agent, not a sandbox: see docs/guide/agents.md."""
    workspace_root: Path | None = None
    """Where the agent's workspace is made; defaults to the system temp directory."""
    agent: AgentConfig = Field(default_factory=AgentConfig)
    feedback: FeedbackConfig = Field(default_factory=FeedbackConfig)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    loop: LoopConfig = Field(default_factory=LoopConfig)
    execution: ExecutionConfig = Field(default_factory=ExecutionConfig)

    @field_validator("train_episodes", "eval_episodes", mode="before")
    @classmethod
    def _one_episode(cls, v: object) -> object:
        """A single episode id written bare (``train_episodes: 3``) reads as a number."""
        return str(v) if isinstance(v, int) and not isinstance(v, bool) else v

    def rss(self) -> Path:
        repo = self.rss_repo or (
            Path(os.environ["ROBOSIMSTUDIO_REPO"]) if os.environ.get("ROBOSIMSTUDIO_REPO") else None
        )
        if repo is None:
            raise ValueError("set rss_repo in the config or ROBOSIMSTUDIO_REPO to a RoboSimStudio checkout")
        runner = Path(repo) / "scripts" / "bench_run.py"
        if not runner.is_file():
            raise FileNotFoundError(f"no RoboSimStudio runner at {runner}")
        return Path(repo).resolve()


class _Loader(yaml.SafeLoader):
    """YAML without 1.1's base-60 numbers, so an episode spec such as ``20:26`` stays a string, not 1226."""


_NUMBERS = ("tag:yaml.org,2002:int", "tag:yaml.org,2002:float")
_Loader.yaml_implicit_resolvers = {
    first: [(tag, regexp) for tag, regexp in resolvers if tag not in _NUMBERS]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
# PyYAML's own patterns, less the sexagesimal branch of each.
_Loader.add_implicit_resolver(
    "tag:yaml.org,2002:int",
    re.compile(r"^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+)$"),
    list("-+0123456789"),
)
_Loader.add_implicit_resolver(
    "tag:yaml.org,2002:float",
    re.compile(
        r"^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?"
        r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"
    ),
    list("-+0123456789."),
)


def _yaml(text: str) -> object:
    return yaml.load(text, Loader=_Loader)


PATH_FIELDS = (("task_root",), ("tools",), ("rss_repo",), ("out_root",), ("workspace_root",), ("skills", "path"))


def _resolve_paths(doc: dict, base: Path) -> dict:
    """*doc* with its relative paths made absolute against *base*, the directory of the document that wrote them."""
    for keys in PATH_FIELDS:
        node = doc
        for key in keys[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict) and node.get(keys[-1]) is not None and not Path(node[keys[-1]]).is_absolute():
            node[keys[-1]] = str((base / node[keys[-1]]).resolve())
    if isinstance(doc.get("off_limits"), list):
        doc["off_limits"] = [p if Path(p).is_absolute() else str((base / p).resolve()) for p in doc["off_limits"]]
    return doc


def _merge(under: dict, over: dict) -> dict:
    out = dict(under)
    for key, value in over.items():
        out[key] = _merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def _read(path: Path, seen: tuple[Path, ...] = ()) -> dict:
    """One document with its ``base`` chain merged under it, every path already absolute."""
    if path in seen:
        raise ValueError(f"config base cycle: {' -> '.join(str(p) for p in (*seen, path))}")
    doc = _resolve_paths(_yaml(path.read_text()) or {}, path.parent)
    base = doc.pop("base", None)
    if base is None:
        return doc
    base_path = Path(base) if Path(base).is_absolute() else (path.parent / base).resolve()
    return _merge(_read(base_path, (*seen, path)), doc)


def load_config(path: str | Path, overrides: list[str] | None = None) -> Config:
    """Read *path* (and its ``base`` chain), then apply ``key.sub=value`` overrides."""
    path = Path(path).resolve()
    doc = _read(path)
    for item in overrides or []:
        key, _, raw = item.partition("=")
        node = doc
        parts = key.strip().split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = _yaml(raw)
    # An override names paths relative to where the command runs.
    cfg = Config.model_validate(_resolve_paths(doc, Path.cwd()))
    # A default left relative (``out_root``) is read against the config's directory.
    if not cfg.out_root.is_absolute():
        cfg.out_root = (path.parent / cfg.out_root).resolve()
    return cfg
