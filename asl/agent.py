# SPDX-License-Identifier: Apache-2.0
"""The coding agent: one headless session per run, resumed every iteration.

The session works in a workspace outside the run directory. Before each call
the loop rewrites the workspace: the current policy in ``workflow/``, the
brief in ``INSTRUCTIONS.md``, the latest ``FEEDBACK.md`` (and its stills in
``frames/`` under the visual form), and the skill library when the run has
one. The session edits ``workflow/`` and checks it with ``./validate.sh``; the
loop reads it back.

The session may not read the run directory (held-out results live there) or
the task's source. For Claude Code, deny rules in the workspace's
``.claude/settings.json`` hold its file tools to this, and keep them from
rewriting ``validate.sh`` or the settings; ``./validate.sh`` reads the policy
without running any of it (see :mod:`asl.check`). The rules bind those tools
and nothing else. The read-only shell commands Claude Code approves on its
own, and every batch of the policy, run with this process's privileges and
can read whatever it can; only a container or VM around the run holds a
session that tries to look. The Codex backend (:mod:`asl.codex`) states the
same rules in ``AGENTS.md`` and audits the session afterwards.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .skills import stage_skills

__all__ = ["Agent", "AgentError", "AgentResult", "make_agent", "tools_markdown"]

PROMPTS = Path(__file__).resolve().parent / "prompts"

TOKEN_KEYS = ("input", "cache_creation_input", "cache_read_input", "output")
"""The token counts kept from each ``claude -p`` call's ``usage``, as ``<key>_tokens``."""

FIRST_PROMPT = "Follow INSTRUCTIONS.md in this directory."
RESUME_PROMPT = (
    "The workspace was rewritten for the next round: INSTRUCTIONS.md is new, and so is FEEDBACK.md "
    "when it is there. Follow INSTRUCTIONS.md."
)

MECHANICS = """

# Workspace

Everything you need is in this directory.

- `WORKFLOW_FORMAT.md`: the workflow format.
- `TOOLS.md`: every tool the policy may call, with its arguments and what it returns.
- `FEEDBACK.md`: what the last run did (absent before the first run).{extra}
- `workflow/`: the policy. {action}

The only shell command you need is `./validate.sh`. Run it exactly as written,
from this directory, before you finish, and fix every error it reports. Do not
run the simulator, install anything, or edit anything outside `workflow/`.
To retire a script, stop referencing it from `workflow.json`.

When the check is clean, stop and say in a few sentences what you changed and why.
"""


def tools_markdown(tools_file: Path) -> str:
    """TOOLS.md, written from the tools file the check reads."""
    doc = json.loads(Path(tools_file).read_text())
    lines = [
        "# Tools",
        "",
        "The complete list of tools a policy may call. Poses are world frame, metres,",
        'as `{"position": {"x","y","z"}, "rotation": {"w","x","y","z"}}`. OBB extents',
        "are half-extents. `arm_id` 0 is the arm that does the work.",
        "",
    ]
    for tool in doc["tools"]:
        params = ", ".join(p["name"] + ("" if p.get("required") else "?") for p in tool.get("params") or [])
        lines += [f"## `{tool['name']}({params})`", "", tool["summary"], "", f"Returns: {tool['returns']}.", ""]
    lines.append("An argument marked `?` is optional.")
    return "\n".join(lines) + "\n"


def digest(directory: Path) -> str:
    """A hash of every file under *directory*, to tell whether the agent changed anything."""
    h = hashlib.sha256()
    if Path(directory).is_dir():
        for path in sorted(Path(directory).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                h.update(str(path.relative_to(directory)).encode())
                h.update(path.read_bytes())
    return h.hexdigest()


def session_env(cfg: Config) -> dict[str, str]:
    """The environment a session starts in: this process's, plus ``agent.env`` with ``$VAR`` expanded."""
    env = dict(os.environ)
    for key, value in (cfg.agent.env or {}).items():
        env[str(key)] = os.path.expandvars(str(value))
    return env


class AgentError(RuntimeError):
    """A session call that timed out, or ended with no result to read."""


def output_text(value: str | bytes | None) -> str:
    """What a process wrote, as text: a timed-out ``subprocess.run`` hands it over as bytes."""
    return value.decode(errors="replace") if isinstance(value, bytes) else (value or "")


@dataclass
class AgentResult:
    summary: str
    usd: float
    turns: int
    changed: bool
    tokens: dict[str, int] | None = None
    """This call's token counts, when the backend reports them."""


class Agent:
    """The workspace, and a resumed Claude Code session over it."""

    def __init__(self, cfg: Config, run_dir: Path) -> None:
        self.cfg = cfg
        self.run_dir = Path(run_dir)
        self._state_path = self.run_dir / "agent_session.json"
        state = json.loads(self._state_path.read_text()) if self._state_path.is_file() else {}
        # One workspace per run directory, and the same one when the run is picked up again.
        root = Path(cfg.workspace_root) if cfg.workspace_root else Path(tempfile.gettempdir())
        tag = hashlib.sha256(str(self.run_dir.resolve()).encode()).hexdigest()[:10]
        self.workspace = Path(state.get("workspace") or root / f"asl-{self.run_dir.name}-{tag}")
        self.session_id: str = state.get("session_id", "")
        self.reported_usd: float = float(state.get("reported_usd", 0.0))
        """The session's cumulative cost as last reported. A resumed ``claude -p``
        reports the whole session's total, so each call costs the difference."""

    # ------------------------------------------------------------ workspace
    def off_limits(self) -> list[Path]:
        """Paths the session may not read."""
        paths = [self.run_dir, Path(self.cfg.task_root), Path(self.cfg.out_root), *self.cfg.off_limits]
        if self.cfg.skills.mode == "listed" and self.cfg.skills.path is not None:
            paths.append(Path(self.cfg.skills.path))
        return paths

    def prepare(
        self,
        workflow: Path | None,
        instructions: str,
        feedback: str | None,
        frames: Path | None = None,
    ) -> None:
        ws = self.workspace
        ws.mkdir(parents=True, exist_ok=True)
        target = ws / "workflow"
        if target.exists():
            shutil.rmtree(target)
        if workflow is not None and Path(workflow).is_dir():
            shutil.copytree(workflow, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            target.mkdir()
        if feedback is not None:
            action = "Edit it in place; read `FEEDBACK.md` first."
        elif any(target.iterdir()):
            action = "It holds the policy the check refused: fix it in place."
        else:
            action = "It is empty: write `workflow/workflow.json` and `workflow/scripts/...`."
        tools = json.loads(Path(self.cfg.tools).read_text())
        allowed = {t["name"] for t in tools["tools"]}
        offered = stage_skills(self.cfg.skills.path, self.cfg.skills.mode, allowed, ws)
        extra = ""
        if offered:
            extra += "\n- `SKILLS.md`: skills you may build on" + (
                ", with their source in `skills/`." if self.cfg.skills.mode == "full" else "."
            )
        shutil.rmtree(ws / "frames", ignore_errors=True)
        if feedback is not None and frames is not None and Path(frames).is_dir() and any(Path(frames).iterdir()):
            shutil.copytree(frames, ws / "frames")
            extra += "\n- `frames/`: the stills `FEEDBACK.md` cites. Open them."
        (ws / "INSTRUCTIONS.md").write_text(instructions.rstrip() + MECHANICS.format(action=action, extra=extra))
        shutil.copyfile(PROMPTS / "workflow_format.md", ws / "WORKFLOW_FORMAT.md")
        (ws / "TOOLS.md").write_text(tools_markdown(self.cfg.tools))
        shutil.copyfile(self.cfg.tools, ws / "tools.json")
        if feedback is None:
            (ws / "FEEDBACK.md").unlink(missing_ok=True)
        else:
            (ws / "FEEDBACK.md").write_text(feedback)
        package = Path(__file__).resolve().parent.parent
        validate = ws / "validate.sh"
        validate.write_text(
            "#!/usr/bin/env bash\n"
            f'PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="{package}${{PYTHONPATH:+:$PYTHONPATH}}" exec "{sys.executable}" '
            # -P: the workspace is not put on the import path, so a file the session writes cannot stand in for a module.
            "-P -m asl.check workflow --tools tools.json\n"
        )
        validate.chmod(0o755)
        deny = [
            f"{tool}({_pattern(p)})" for p in self.off_limits() for tool in ("Read", "Grep", "Glob", "Edit", "Write")
        ]
        # The check and the rules themselves are not the session's to rewrite.
        deny += [f"{tool}({_pattern(p)})" for p in (validate, ws / ".claude") for tool in ("Edit", "Write")]
        (ws / ".claude").mkdir(exist_ok=True)
        (ws / ".claude" / "settings.json").write_text(json.dumps({"permissions": {"deny": deny}}, indent=2) + "\n")

    def _save_state(self, **extra: object) -> None:
        state = {"session_id": self.session_id, "reported_usd": self.reported_usd, "workspace": str(self.workspace)}
        state.update(extra)
        self._state_path.write_text(json.dumps(state, indent=2) + "\n")

    # ------------------------------------------------------------ the call
    def call(self, out_dir: Path) -> AgentResult:
        """One turn of the session over the prepared workspace.

        ``claude -p`` prints only the call's final result, which goes to
        *out_dir* (``stdout.json``); the turn-by-turn transcript stays in
        Claude Code's own session log. Raises :class:`AgentError` when the call
        times out or ends with no result.
        """
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        agent = self.cfg.agent
        before = digest(self.workspace / "workflow")
        if self.session_id:
            session_args, prompt = ["--resume", self.session_id], RESUME_PROMPT
        else:
            self.session_id = str(uuid.uuid4())
            session_args, prompt = ["--session-id", self.session_id], FIRST_PROMPT
        cmd = [
            agent.claude_binary,
            "-p",
            prompt,
            *session_args,
            "--output-format",
            "json",
            "--max-turns",
            str(int(agent.max_turns)),
            "--allowedTools",
            agent.allowed_tools,
        ]
        if agent.model:
            cmd += ["--model", agent.model]
        env = session_env(self.cfg)
        if agent.thinking_tokens:
            env["MAX_THINKING_TOKENS"] = str(int(agent.thinking_tokens))
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(self.workspace),
                capture_output=True,
                text=True,
                env=env,
                timeout=agent.timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            (out_dir / "stdout.json").write_text(output_text(exc.stdout))
            (out_dir / "stderr.log").write_text(output_text(exc.stderr))
            raise AgentError(f"claude did not finish in {agent.timeout_s:.0f} s; see {out_dir}") from exc
        (out_dir / "stdout.json").write_text(proc.stdout or "")
        (out_dir / "stderr.log").write_text(proc.stderr or "")
        try:
            doc = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else {}
        except (json.JSONDecodeError, IndexError):
            doc = {}
        if proc.returncode != 0 and not doc:
            raise AgentError(f"claude exited {proc.returncode}; see {out_dir / 'stderr.log'}")
        total = float(doc.get("total_cost_usd") or 0.0)
        usd = total - self.reported_usd if total >= self.reported_usd else total
        self.reported_usd = total
        self.session_id = str(doc.get("session_id") or self.session_id)
        self._save_state()
        # ``usage`` is this call's; ``modelUsage`` is the session's running total, like the cost.
        usage = doc.get("usage") if isinstance(doc.get("usage"), dict) else None
        return AgentResult(
            summary=str(doc.get("result") or ""),
            usd=usd,
            turns=int(doc.get("num_turns") or 0),
            changed=digest(self.workspace / "workflow") != before,
            tokens={key: int(usage.get(f"{key}_tokens") or 0) for key in TOKEN_KEYS} if usage else None,
        )

    def archive(self, out_dir: Path) -> None:
        """Keep a copy of what the session was shown and wrote, beside its result."""
        target = Path(out_dir) / "workspace"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(
            self.workspace, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".claude", "skills", "frames")
        )


def _pattern(path: Path) -> str:
    """A permission rule's absolute path: the file itself, or everything under a directory."""
    path = Path(path).resolve()
    return f"//{str(path).lstrip('/')}" + ("" if path.is_file() else "/**")


def make_agent(cfg: Config, run_dir: Path) -> Agent:
    """The session for ``cfg.agent.kind``."""
    if cfg.agent.kind == "codex":
        from .codex import CodexAgent  # noqa: PLC0415

        return CodexAgent(cfg, run_dir)
    return Agent(cfg, run_dir)
