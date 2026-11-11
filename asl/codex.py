# SPDX-License-Identifier: Apache-2.0
"""OpenAI's Codex CLI as the agent: the same workspace, ``codex exec`` instead of ``claude -p``.

The workspace is the one :class:`~asl.agent.Agent` prepares, so a Codex
session reads exactly what a Claude Code session reads. The session is
started once with ``codex exec`` and continued every iteration with
``codex exec resume <thread>``. Two things differ, and are stated rather than
hidden:

* **Sandbox.** ``agent.codex_sandbox`` (default ``workspace-write``) limits
  what the session may write, not what it may read. The off-limits paths
  (held-out results, the task's source) are named as forbidden in
  ``AGENTS.md``, and every command the session ran is audited afterwards: a
  command or file change naming an off-limits path is written to
  ``offlimits_hits.json`` beside the transcript and printed, so the iteration
  can be discarded. On hosts where Codex's own sandbox cannot start,
  ``danger-full-access`` runs commands with no sandbox at all; use it only
  inside a container or VM you control.
* **Cost.** A ChatGPT login meters nothing in dollars. Token counts are summed
  from the session's ``turn.completed`` events and recorded; ``usd`` is 0, so
  ``loop.max_usd`` never stops a Codex run.

Transcript: ``--json`` writes one event per line. ``item.completed`` items of
type ``command_execution`` carry each command (one turn each),
``agent_message`` items carry the model's prose (the last one is the summary),
``turn.completed`` carries usage, and ``turn.failed`` / ``error`` carry failures.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .agent import Agent, AgentError, AgentResult, digest, output_text, session_env

__all__ = ["CodexAgent"]

PROMPT = "Follow INSTRUCTIONS.md in this directory. AGENTS.md states the rules."
RESUME = (
    "The workspace was rewritten for the next round: INSTRUCTIONS.md is new, and so is FEEDBACK.md "
    "when it is there. Follow INSTRUCTIONS.md; AGENTS.md states the rules."
)


def _agents_md(off_limits: list[Path]) -> str:
    """``AGENTS.md``: the rules Claude Code's settings file enforces, stated for Codex."""
    forbidden = "".join(f"- `{Path(p).resolve()}`\n" for p in off_limits)
    return (
        "# Rules for this workspace\n\n"
        "Follow `INSTRUCTIONS.md`. Everything you need is in this directory.\n\n"
        "- Edit only `workflow/`. Do not edit, create or delete anything else here.\n"
        "- The only command you need is `./validate.sh`, run from this directory. Do not run the\n"
        "  simulator, install packages, or start background processes.\n"
        "- Do not read, list or search anything outside this directory. In particular these paths hold\n"
        "  held-out results and the task's source and are OFF LIMITS; reading any of them\n"
        "  invalidates the run:\n"
        + (forbidden or "- (none named)\n")
        + "- When `./validate.sh` is clean, finish with a few sentences on what you changed and why.\n"
    )


def _events(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def audit_offlimits(events: list[dict], off_limits: list[Path]) -> list[dict]:
    """Every command the session ran, or file it changed, that names an off-limits path.

    Only what the agent did counts: the command text and the paths of file
    changes. A command's output is not scanned: ``cat AGENTS.md`` prints the
    rules, and the rules name the very paths they forbid.
    """
    needles = [str(Path(p).resolve()) for p in off_limits]
    hits: list[dict] = []
    if not needles:
        return hits
    for ev in events:
        item = ev.get("item") or {}
        kind = item.get("type", ev.get("type"))
        if kind == "command_execution":
            texts = [str(item.get("command", ""))]
        elif kind == "file_change":
            texts = [str(c.get("path", "")) for c in (item.get("changes") or []) if isinstance(c, dict)]
        else:
            continue
        for needle in needles:
            if any(needle in t for t in texts):
                hits.append({"path": needle, "item_type": kind, "command": (texts[0] if texts else "")[:300]})
                break
    return hits


def parse_events(events: list[dict]) -> tuple[str, int, dict[str, int], str]:
    """``(last message, commands run, token counts, thread id)`` from one session's events."""
    prompt = completion = cached = 0
    messages: list[str] = []
    commands = 0
    thread = ""
    for ev in events:
        if ev.get("type") == "thread.started":
            thread = str(ev.get("thread_id") or ev.get("session_id") or ev.get("id") or "")
        if ev.get("type") == "turn.completed":
            usage = ev.get("usage") or {}
            prompt += int(usage.get("input_tokens", 0) or 0)
            cached += int(usage.get("cached_input_tokens", 0) or 0)
            completion += int(usage.get("output_tokens", 0) or 0) + int(usage.get("reasoning_output_tokens", 0) or 0)
        item = ev.get("item") or {}
        if ev.get("type") == "item.completed":
            if item.get("type") == "agent_message" and item.get("text"):
                messages.append(str(item["text"]))
            elif item.get("type") == "command_execution":
                commands += 1
    tokens = {"input": prompt, "cached_input": cached, "output": completion}
    return (messages[-1] if messages else ""), commands, tokens, thread


class CodexAgent(Agent):
    """The workspace, and a resumed ``codex exec`` session over it."""

    def prepare(self, workflow, instructions, feedback, frames=None) -> None:
        super().prepare(workflow, instructions, feedback, frames)
        (self.workspace / "AGENTS.md").write_text(_agents_md(self.off_limits()))

    def call(self, out_dir: Path) -> AgentResult:
        out_dir = Path(out_dir).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        agent = self.cfg.agent
        before = digest(self.workspace / "workflow")
        options = [
            "--json",
            "--skip-git-repo-check",
            "-o",
            str(out_dir / "last_message.txt"),
            "-c",
            f'sandbox_mode="{agent.codex_sandbox}"',
        ]
        if agent.model:
            options += ["-m", agent.model]
        if agent.reasoning_effort:
            options += ["-c", f'model_reasoning_effort="{agent.reasoning_effort}"']
        if agent.codex_sandbox == "danger-full-access":
            print("[asl] WARNING: the Codex session runs with no sandbox (danger-full-access)", flush=True)
        if self.session_id:
            cmd = [agent.codex_binary, "exec", "resume", *options, self.session_id, RESUME]
        else:
            cmd = [agent.codex_binary, "exec", *options, PROMPT]
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(self.workspace),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                env=session_env(self.cfg),
                timeout=agent.timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            (out_dir / "stdout.json").write_text(output_text(exc.stdout))
            (out_dir / "stderr.log").write_text(output_text(exc.stderr))
            raise AgentError(f"codex did not finish in {agent.timeout_s:.0f} s; see {out_dir}") from exc
        (out_dir / "stdout.json").write_text(proc.stdout or "")
        (out_dir / "stderr.log").write_text(proc.stderr or "")
        events = _events(proc.stdout or "")
        summary, commands, tokens, thread = parse_events(events)
        if not events and proc.returncode != 0:
            raise AgentError(f"codex exited {proc.returncode}; see {out_dir / 'stderr.log'}")
        if commands == 0 and "bwrap" in (proc.stdout or "") + (proc.stderr or ""):
            raise AgentError(
                f"Codex's sandbox could not start on this host, so the session could run no command "
                f"(see {out_dir / 'stdout.json'}). Run inside a container or VM you control with "
                f"agent.codex_sandbox: danger-full-access; see docs/guide/agents.md."
            )
        hits = audit_offlimits(events, self.off_limits())
        if hits:
            (out_dir / "offlimits_hits.json").write_text(json.dumps(hits, indent=2) + "\n")
            print(
                f"[asl] WARNING: the Codex session named {len(hits)} off-limits path(s) "
                f"(see {out_dir / 'offlimits_hits.json'}); treat this iteration as tainted",
                flush=True,
            )
        self.session_id = thread or self.session_id
        state = json.loads(self._state_path.read_text()) if self._state_path.is_file() else {}
        total = state.get("tokens") or {"input": 0, "cached_input": 0, "output": 0}
        total = {k: int(total.get(k, 0)) + int(tokens.get(k, 0)) for k in ("input", "cached_input", "output")}
        self._save_state(kind="codex", tokens=total)
        return AgentResult(
            summary=summary,
            usd=0.0,
            turns=commands,
            changed=digest(self.workspace / "workflow") != before,
            tokens=tokens,
        )
