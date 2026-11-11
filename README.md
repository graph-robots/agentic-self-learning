# agentic-self-learning

[![arXiv](https://img.shields.io/badge/arXiv-2611.09030-b31b1b.svg)](https://arxiv.org/abs/2611.09030)
[![Project page](https://img.shields.io/badge/project-page-0f766e.svg)](https://graph-robots.github.io/agentic-self-learning/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)

A coding agent writes a robot policy, runs it in simulation, reads what
happened, and rewrites the policy. This repository is that loop, for any
[RoboSimStudio](https://github.com/robosimstudio/robosimstudio) task, with the
simulation feedback the paper studied as a setting you choose.

It accompanies *A Controlled Study of Models, Skills, Feedback, and Curriculum
in Agentic Robotics* ([paper (arXiv)](https://arxiv.org/abs/2611.09030),
[project page](https://graph-robots.github.io/agentic-self-learning/),
[agent traces](https://huggingface.co/datasets/keplerccc/agentic-robotics-coding-traces)).

The policy is a [graph-as-policy](https://github.com/graph-robots/graph-as-policy)
(GaP) workflow: a `workflow.json` graph of tool calls and short Python scripts.
The agent is a headless [Claude Code](https://claude.com/claude-code) or
[Codex](https://github.com/openai/codex) session.

## How the loop works

1. **Write.** The agent gets the instruction, the workflow format and the list
   of tools (and, if the run has one, a skill library), and writes a policy into
   its workspace.
2. **Check.** GaP's validator runs, and every tool the policy calls must be on
   the task's allowlist with arguments the tool takes. A rejected policy goes
   back to the agent with the errors.
3. **Train.** RoboSimStudio runs the policy on the training episodes and records
   everything that happened in them. The task's evaluator scores each one; the
   policy's own claim of success counts for nothing.
4. **Held out.** Every few iterations the policy also runs on held-out
   episodes. The agent is never shown these results.
5. **Feedback.** The training batch becomes `FEEDBACK.md`, written for the run's
   feedback condition (below).
6. **Edit.** The same agent session resumes, reads the feedback, edits the
   policy, and the loop goes back to step 2.

The run stops after a set number of iterations, after two perfect training
batches in a row, or at a cost limit. It delivers the iterate with the best
training score, and scores that iterate on the held-out episodes.

## Quick start

You need an NVIDIA GPU, [uv](https://docs.astral.sh/uv/), and the `claude` CLI
logged in (or `codex`, for the Codex configs).

```bash
git clone https://github.com/robosimstudio/robosimstudio.git
git -C robosimstudio checkout 87b5e32               # the revision pyproject.toml pins
git clone https://github.com/graph-robots/agentic-self-learning.git
cd agentic-self-learning
uv sync --python 3.12                               # RoboSimStudio, graph-as-policy and this package
export ROBOSIMSTUDIO_REPO=$PWD/../robosimstudio

uv run asl-run --config examples/cube_in_tray/config.yaml --set execution.gpu=0
```

Everything lands in `outputs/cube_in_tray/<timestamp>/`:

| Path | What it is |
|---|---|
| `report.json` | Training and held-out curves, the delivered iterate, agent cost |
| `ledger.jsonl` | One line per event |
| `iterations/kNNN/workflow/` | The policy that ran at iteration N |
| `iterations/kNNN/FEEDBACK.md` | What the agent read after it |
| `iterations/kNNN/feedback.json` | Every fact about the batch, whatever the condition showed |
| `iterations/kNNN/agent/round*/` | The agent's final result (`stdout.json`; for Codex, its full event stream), summary, and workspace |
| `iterations/kNNN/train/`, `eval/` | RoboSimStudio's results for each episode |
| `policy/` | The delivered policy |

To watch a policy, record it on the held-out episodes:

```bash
uv run asl-rollout --config examples/cube_in_tray/config.yaml --graph examples/cube_in_tray/policy
```

## Feedback conditions

What the agent reads after each batch is set by three choices in the config's
`feedback` block. The default is the condition the paper found most useful.

| Setting | Values | What changes |
|---|---|---|
| `form` | `state`, `relations`, `visual`, or `[]` | What simulation feedback the agent gets beyond the outcome: numbers (positions, distances, offsets), predicates (inside, rests on, grasped, came into contact), or stills of the recorded video. `[]` is the outcome only: success, steps, how each episode ended, and the error the policy's graph raised, if it raised one. |
| `spatial` | `positions`, `frames`, `parts` | How space is written: world positions of whole objects; plus orientations and offsets in each object's own frame; plus the parts each asset declares (a handle, a rim, an axis). |
| `granularity` | `episode`, `motion`, `semantic` | When: once per episode (start and end), after every tool call that stepped the simulation, or after every node of the agent's own workflow, under its own names. |

The default is `form: [state, relations]`, `spatial: parts`,
`granularity: semantic`. [`examples/cube_in_tray/configs/`](examples/cube_in_tray/configs)
has one file per condition. [docs/guide/feedback.md](docs/guide/feedback.md)
shows the same batch under each of them.

Every condition is rendered from the same record of the batch
(`feedback.json`), so conditions differ only in what they show. To see one
batch under another condition:

```bash
uv run asl-feedback outputs/cube_in_tray/<timestamp>/iterations/k000 --spatial positions --granularity motion
```

The `visual` form is the exception: a batch is recorded on video only in a
run whose own `form` includes `visual`, so only such a run's batches have
stills to show.

## Agents

`agent.kind` is `claude_code` (the default, Claude Opus 5.5) or `codex`. Both
work in the same workspace and resume one session for the whole run.
`agent.thinking_tokens` sets Claude Code's thinking budget and
`agent.reasoning_effort` Codex's. `agent.env` passes environment to the session,
for example an Anthropic-compatible endpoint:

```yaml
agent:
  model: <the endpoint's model id>
  env:
    ANTHROPIC_BASE_URL: https://your-endpoint.example
    ANTHROPIC_AUTH_TOKEN: $YOUR_KEY_VARIABLE      # expanded when the session starts, never written down
    ANTHROPIC_API_KEY: ""
```

Claude Code's file tools are denied the run directory and the task's source;
Codex is given the same rules and audited for what the session ran. Neither
is a sandbox: the check reads the policy without running it, but every
batch runs it with your privileges, so a model you do not trust needs
OS-level isolation (a container or VM) around it. See
[docs/guide/agents.md](docs/guide/agents.md).

## Skills

`skills.path` points at a library in the Agent Skills format, for example
[open-robot-skills](https://github.com/graph-robots/open-robot-skills).
`skills.mode: listed` gives the agent each skill's name, description, tools and
exits; `full` also copies each skill's source into the workspace. Only skills
whose every tool is in the task's tools file are offered. See
[docs/guide/skills.md](docs/guide/skills.md).

## The example

[`examples/cube_in_tray`](examples/cube_in_tray) asks one arm to "pick up the
red cube and put it in the tray". Every episode draws where the cube and the
tray stand, how the cube is turned, and how heavy and slippery both are. Its
README has the measured run and the policy it delivered.

## A task of your own

A task is three files beside each other:

- **A task directory** in RoboSimStudio's task language: a `.task` document
  with the scene, the goal and the episode sampler, plus any Python it names.
  See `examples/cube_in_tray/tasks/cube_in_tray/`. Declare your objects' parts
  as features on their asset records to make `spatial: parts` mean something.
- **`tools.json`**: the tools the policy may call, with their parameters and
  what they return. The agent reads it as `TOOLS.md`, and the check enforces it.
- **`config.yaml`**: the task, the instruction, the training and held-out
  episode ids, the feedback condition, and the loop's limits. Every field is in
  [docs/guide/configuration.md](docs/guide/configuration.md).

See [docs/guide/tasks.md](docs/guide/tasks.md).

## Layout

| Path | What it is |
|---|---|
| `asl/loop.py` | The loop |
| `asl/agent.py`, `asl/codex.py` | The agent's workspace, and the Claude Code and Codex sessions |
| `asl/check.py` | The static check (`python -m asl.check`) and the edit-size counters |
| `asl/runner.py` | Runs a policy on a set of episodes with RoboSimStudio |
| `asl/feedback/` | The feedback: read the capture, derive facts and goals, build the packet, render a condition |
| `asl/skills.py` | The skill library: what is offered, and how |
| `asl/prompts/` | The workflow format and the briefs the agent gets |
| `examples/cube_in_tray/` | The example task, its configs and tools, and the delivered policy |
| `docs/guide/` | Feedback conditions, configuration, agents, skills, tasks, and how this relates to the paper's runs |
| `docs/` | The project page |

## Tests

```bash
uv run pytest
```

The tests need neither a GPU nor an agent.

## Citation

```bibtex
@misc{chen2026controlled,
  title         = {A Controlled Study of Models, Skills, Feedback, and Curriculum in Agentic Robotics},
  author        = {Chen, Kaiyuan and Zhu, Xinyue and Xie, Shuangyu and Yoo, Uksang and Luong, Thi Thu Phuong and Gualtieri, Marcus and Juette, Christian and Ren, Liu and Huang, Spencer and Goldberg, Ken},
  year          = {2026},
  eprint        = {2611.09030},
  archivePrefix = {arXiv},
  primaryClass  = {cs.RO},
  url           = {https://arxiv.org/abs/2611.09030}
}
```

## License

Apache-2.0. See [LICENSE](LICENSE).
