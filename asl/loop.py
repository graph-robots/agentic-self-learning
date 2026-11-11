# SPDX-License-Identifier: Apache-2.0
"""The self-learning loop.

    k = 0: the agent writes a policy from the instruction.
    every k: check it -> run it on the training episodes -> (sometimes) on the
             held-out episodes -> build the feedback packet from the training
             batch and render FEEDBACK.md for the run's feedback condition ->
             the agent edits the policy -> k + 1.

The agent sees the training feedback only. Held-out results are recorded in the
run directory, which the agent's session may not read. The run delivers the
iterate with the best training score (ties go to the latest), and always scores
that iterate on the held-out episodes.

Run directory, ``<out_root>/<name>/<timestamp>/``:

    config.yaml           the resolved config
    ledger.jsonl          one line per event
    report.json           curves, cost, the delivered iterate
    agent_session.json    the session id and its reported cost
    iterations/kNNN/      workflow/, agent/round*/, train/, eval/, FEEDBACK.md,
                          feedback.json (every fact, whatever the condition shows),
                          frames/ (the visual form's stills)
    policy/               the delivered iterate: workflow.json and the scripts it uses
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any

import yaml

from .agent import AgentError, AgentResult, make_agent
from .check import check_workflow, edit_size, load_tools
from .config import Config
from .feedback import IterationSummary, behavior_digest, build_packet, render, stage_frames, view
from .feedback.schema import FeedbackPacket
from .runner import Batch, run_batch

__all__ = ["Loop"]

PROMPTS = Path(__file__).resolve().parent / "prompts"


def _template(name: str, **values: str) -> str:
    text = (PROMPTS / name).read_text()
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


class Loop:
    def __init__(self, cfg: Config, run_dir: Path | None = None) -> None:
        self.cfg = cfg
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self.run_dir = (Path(run_dir) if run_dir else Path(cfg.out_root) / cfg.name / stamp).resolve()
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.tools = load_tools(cfg.tools)
        self.agent = make_agent(cfg, self.run_dir)
        self.iterations: list[dict[str, Any]] = []
        self.spent = 0.0
        self.tokens: dict[str, int] = {}
        """Summed token counts, for a backend that reports no dollars."""
        self.started = time.time()

    # ------------------------------------------------------------ records
    def log(self, event: str, **fields: Any) -> None:
        row = {"t": round(time.time() - self.started, 1), "event": event, **fields}
        with (self.run_dir / "ledger.jsonl").open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        print(f"[asl] {event} " + " ".join(f"{k}={v}" for k, v in fields.items()), flush=True)

    def _best(self) -> dict[str, Any] | None:
        scored = [it for it in self.iterations if it.get("train")]
        if not scored:
            return None
        return max(scored, key=lambda it: (it["train"]["successes"] / max(1, it["train"]["n"]), it["k"]))

    def _report(self, stopped: str) -> dict[str, Any]:
        best = self._best()
        report = {
            "name": self.cfg.name,
            "task": self.cfg.task,
            "instruction": self.cfg.instruction,
            "agent": self.cfg.agent.kind,
            "model": self.cfg.agent.model or "(the CLI's default)",
            "feedback": self.cfg.feedback.model_dump(include={"form", "spatial", "granularity"}),
            "iterations": self.iterations,
            "train_curve": [
                [it["k"], it["train"]["successes"], it["train"]["n"]] for it in self.iterations if it.get("train")
            ],
            "eval_curve": [
                [it["k"], it["eval"]["successes"], it["eval"]["n"]] for it in self.iterations if it.get("eval")
            ],
            "best_by_train": best["k"] if best else None,
            "agent_usd": round(self.spent, 4),
            "agent_tokens": self.tokens or None,
            "wall_min": round((time.time() - self.started) / 60.0, 1),
            "stopped": stopped,
        }
        (self.run_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        return report

    # ------------------------------------------------------------ steps
    def _propose(
        self, it_dir: Path, previous: Path | None, brief: str, feedback: str | None, frames: Path | None
    ) -> list[str]:
        """Let the agent write or edit the policy until it passes the check; return what is still wrong."""
        workspace_policy = self.agent.workspace / "workflow"
        source, instructions = previous, brief
        errors: list[str] = []
        for round_ in range(1 + self.cfg.loop.fix_rounds):
            self.agent.prepare(source, instructions, feedback, frames)
            result: AgentResult = self.agent.call(it_dir / "agent" / f"round{round_}")
            self.spent += result.usd
            for key, value in (result.tokens or {}).items():
                self.tokens[key] = self.tokens.get(key, 0) + int(value)
            self.agent.archive(it_dir / "agent" / f"round{round_}")
            try:
                errors = check_workflow(workspace_policy, self.tools)
            except Exception as exc:  # noqa: BLE001 - a policy the check cannot read is a rejected one
                errors = [f"the check could not read the policy: {type(exc).__name__}: {exc}"]
            self.log(
                "agent",
                k=int(it_dir.name[1:]),
                round=round_,
                usd=round(result.usd, 4),
                turns=result.turns,
                changed=result.changed,
                errors=len(errors),
            )
            (it_dir / "agent" / f"round{round_}" / "summary.md").write_text(result.summary + "\n")
            if not errors:
                return []
            # Keep the rejected proposal in front of the agent, with what is wrong with it.
            staged = it_dir / "agent" / f"round{round_}" / "rejected"
            shutil.copytree(workspace_policy, staged, dirs_exist_ok=True)
            source = staged
            instructions = _template("fix.md", errors="\n".join(errors)) + "\n\n" + brief
        return errors

    def _evaluate(self, record: dict[str, Any], it_dir: Path) -> None:
        batch: Batch = run_batch(self.cfg, it_dir / "workflow", self.cfg.eval_episodes, it_dir, "eval", capture=False)
        record["eval"] = {"successes": batch.successes, "n": batch.n}
        self.log("eval", k=record["k"], successes=batch.successes, n=batch.n)

    def _history(self, k: int) -> list[IterationSummary]:
        """What iterations 0..k-1 did, for the feedback on iteration *k*'s batch.

        Each row is one earlier batch and the edit made after reading it: the
        batch's train rate and what its policy did (from its ``feedback.json``),
        the agent's own summary of the edit, whether the edit passed the check,
        and how large it was.
        """
        rows: list[IterationSummary] = []
        for j in range(k):
            here, after = self.iterations[j], self.iterations[j + 1]
            it_j = self.run_dir / "iterations" / f"k{j:03d}"
            it_next = self.run_dir / "iterations" / f"k{j + 1:03d}"
            rounds = sorted((it_next / "agent").glob("round*/summary.md"), key=lambda p: int(p.parent.name[5:]))
            proposal = it_next / "workflow"
            if after.get("rejected") and rounds:
                proposal = rounds[-1].parent / "rejected"
            digest: dict[str, Any] = {}
            if (it_j / "feedback.json").is_file():
                digest = behavior_digest(FeedbackPacket.model_validate_json((it_j / "feedback.json").read_text()))
            train = here.get("train") or {}
            rows.append(
                IterationSummary(
                    iteration=j,
                    train_success_rate=(train["successes"] / train["rows"]) if train.get("rows") else None,
                    train_n=int(train.get("rows") or 0),
                    change=rounds[-1].read_text().strip() if rounds else "",
                    diff_stats=edit_size(it_j / "workflow", proposal),
                    accepted=not after.get("rejected"),
                    changed=bool(after.get("changed")),
                    **digest,
                )
            )
        return rows

    def _feedback(self, k: int, it_dir: Path, train: Batch) -> str:
        """Build iteration *k*'s packet from its training batch; write it, its rendering and its stills."""
        cfg = self.cfg
        packet = build_packet(
            train.run_dir,
            train.rows,
            iteration=k,
            task=cfg.task,
            instruction=cfg.instruction,
            requested=train.requested,
            history=self._history(k),
            feedback=cfg.feedback,
        )
        (it_dir / "feedback.json").write_text(packet.model_dump_json() + "\n")
        text = render(packet, cfg.feedback)
        (it_dir / "FEEDBACK.md").write_text(text)
        world = bool({"state", "relations"} & set(cfg.feedback.form))
        if world and cfg.feedback.spatial == "parts" and not packet.declared_features:
            self.log("warning", k=k, message="spatial is parts but no asset declares a part; FEEDBACK.md reads as frames")
        if world and train.rows and any(ep.point_start is None for ep in packet.episodes):
            missing = sum(1 for ep in packet.episodes if ep.point_start is None)
            self.log("warning", k=k, message=f"{missing} episode(s) have no readable capture; their feedback is outcome only")
        if "visual" in cfg.feedback.form:
            stills = stage_frames(view(packet, cfg.feedback), it_dir / "frames")
            if not stills:
                self.log("warning", k=k, message="the visual form produced no stills")
        return text

    # ------------------------------------------------------------ the loop
    def run(self) -> dict[str, Any]:
        cfg = self.cfg
        (self.run_dir / "config.yaml").write_text(yaml.safe_dump(json.loads(cfg.model_dump_json()), sort_keys=False))
        self.log(
            "start", run_dir=str(self.run_dir), task=cfg.task, agent=cfg.agent.kind, model=cfg.agent.model,
            feedback=f"{'+'.join(cfg.feedback.form) or 'outcome'}/{cfg.feedback.spatial}/{cfg.feedback.granularity}",
            robosimstudio=_revision(cfg.rss()),
        )
        previous: Path | None = None
        feedback: str | None = None
        streak = 0
        stopped = "iterations"
        last = cfg.loop.iterations - 1
        for k in range(cfg.loop.iterations):
            if self.spent >= cfg.loop.max_usd:
                stopped = "max_usd"
                break
            it_dir = self.run_dir / "iterations" / f"k{k:03d}"
            it_dir.mkdir(parents=True, exist_ok=True)
            if feedback is None:
                brief = _template("generate.md", instruction=cfg.instruction)
            else:
                brief = _template("improve.md", instruction=cfg.instruction)
            frames = previous.parent / "frames" if previous is not None else None
            try:
                errors = self._propose(it_dir, previous, brief, feedback, frames)
            except AgentError as exc:
                # The session may have stopped mid-edit: deliver what was scored so far.
                stopped = "agent_error"
                self.log("stop", reason=stopped, message=str(exc)[:500])
                break
            record: dict[str, Any] = {"k": k}
            if errors:
                (it_dir / "rejected.txt").write_text("\n".join(errors) + "\n")
                if previous is None:
                    stopped = "no valid first policy"
                    self.log("stop", reason=stopped, errors=len(errors))
                    break
                # The agent's edit never passed the check: the last good policy runs again.
                shutil.copytree(previous, it_dir / "workflow")
                record["rejected"] = True
            else:
                shutil.copytree(
                    self.agent.workspace / "workflow",
                    it_dir / "workflow",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
                )
            record["changed"] = previous is None or _differs(previous, it_dir / "workflow")

            visual = "visual" in cfg.feedback.form
            train = run_batch(
                cfg, it_dir / "workflow", cfg.train_episodes, it_dir, "train",
                record=visual, cameras=cfg.feedback.cameras or None,
            )
            record["train"] = {"successes": train.successes, "n": train.n, "rows": len(train.rows)}
            self.log("train", k=k, successes=train.successes, n=train.n)
            if k == 0 or k == last or k % max(1, cfg.loop.eval_every) == 0:
                self._evaluate(record, it_dir)
            record["agent_usd"] = round(self.spent, 4)
            self.iterations.append(record)

            feedback = self._feedback(k, it_dir, train)
            previous = it_dir / "workflow"
            self._report("running")

            streak = streak + 1 if train.n and train.successes == train.n else 0
            if streak >= cfg.loop.perfect_streak:
                stopped = "perfect_streak"
                break

        best = self._best()
        if best is not None:
            best_dir = self.run_dir / "iterations" / f"k{best['k']:03d}"
            if not best.get("eval"):
                self._evaluate(best, best_dir)
            deliver(best_dir / "workflow", self.run_dir / "policy")
        report = self._report(stopped)
        # Every round's workspace is archived under iterations/; the live one is not needed again.
        shutil.rmtree(self.agent.workspace, ignore_errors=True)
        self.log("done", stopped=stopped, best_by_train=report["best_by_train"], agent_usd=report["agent_usd"])
        return report


def deliver(workflow_dir: Path, dest: Path) -> list[str]:
    """Copy a policy to *dest* with only the files it uses: ``workflow.json``, the scripts
    it references, and any module in the policy those scripts import. Returns the files copied.
    A script named outside the policy's directory is not copied."""
    import ast

    from .check import _calls, _inside

    workflow_dir, dest = Path(workflow_dir), Path(dest)
    _, scripts = _calls(json.loads((workflow_dir / "workflow.json").read_text()))
    modules = {p.stem: p for p in workflow_dir.rglob("*.py") if "__pycache__" not in p.parts}
    keep: list[Path] = []
    queue = [workflow_dir / s for s in dict.fromkeys(scripts) if _inside(workflow_dir, s)]
    while queue:
        path = queue.pop()
        if path in keep or not path.is_file():
            continue
        keep.append(path)
        for node in ast.walk(ast.parse(path.read_text())):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else []
            if isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            queue += [modules[n.split(".")[-1]] for n in names if n.split(".")[-1] in modules]
    if dest.exists():
        shutil.rmtree(dest)
    copied = ["workflow.json"]
    dest.mkdir(parents=True)
    shutil.copyfile(workflow_dir / "workflow.json", dest / "workflow.json")
    for path in sorted(keep):
        relative = path.relative_to(workflow_dir)
        (dest / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest / relative)
        copied.append(str(relative))
    return copied


def _revision(repo: Path) -> str:
    """The RoboSimStudio checkout's commit, so a run records what it ran on."""
    import subprocess

    try:
        return subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
        ).stdout.strip()
    except OSError:
        return ""


def _differs(a: Path, b: Path) -> bool:
    from .agent import digest

    return digest(a) != digest(b)
