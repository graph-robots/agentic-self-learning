# Configuration

A run is one YAML document (see [`examples/cube_in_tray/config.yaml`](../../examples/cube_in_tray/config.yaml)).
Every field is defined in [`asl/config.py`](../../asl/config.py).

- Relative paths are read against the directory of the document that names them.
- A document may name a `base` document, which it overlays key by key. The configs in
  [`examples/cube_in_tray/configs/`](../../examples/cube_in_tray/configs) are short overlays of the
  example's config: a `base`, a `name`, and the fields that condition changes.
- On the command line, `--set key.sub=value` overrides any field after the documents are merged. A
  path given there is read against the current directory. The value is read as YAML, except that
  `a:b` stays text, so `--set eval_episodes=20:26` names episodes 20 to 25.

## Top level

| Field | Default | Meaning |
|---|---|---|
| `name` | (required) | The run's name; outputs go to `<out_root>/<name>/<timestamp>/`. |
| `task` | (required) | `suite/variant` of the task document. |
| `task_root` | (required) | The directory holding the task's suite (`<task_root>/<suite>/<variant>.task`). |
| `instruction` | (required) | What the agent is asked to do, in one sentence. |
| `tools` | (required) | The tools file: every tool the policy may call, with its parameters. |
| `train_episodes` | `"0:6"` | Training episode ids: `a:b` (half-open), `a:b:step`, `a,b,c` or `a`. |
| `eval_episodes` | `"20:26"` | Held-out episode ids. Scored and recorded, never shown to the agent. |
| `rss_repo` | `$ROBOSIMSTUDIO_REPO` | The RoboSimStudio checkout whose `scripts/bench_run.py` runs the policy. |
| `out_root` | `outputs` (beside the config) | Where run directories go. |
| `off_limits` | `[]` | More paths the agent's file tools may not read, beside the run directory, the task root and the output root. Not a sandbox; see [agents.md](agents.md). |
| `workspace_root` | the system temp directory | Where the agent's workspace is made. |

## `agent`

| Field | Default | Meaning |
|---|---|---|
| `kind` | `claude_code` | `claude_code` (`claude -p`) or `codex` (`codex exec`). See [agents.md](agents.md). |
| `model` | Claude Opus 5.5 for `claude_code`; the CLI's default for `codex` | The model id. |
| `max_turns` | `80` | Claude Code only: turns per call. |
| `thinking_tokens` | `0` | Claude Code only: `MAX_THINKING_TOKENS`; 0 leaves the CLI's default. |
| `reasoning_effort` | `""` | Codex only: `model_reasoning_effort` (`low`, `medium`, `high`, `xhigh`). |
| `env` | `{}` | Extra environment for the session; `$VAR` is expanded when it starts. |
| `codex_sandbox` | `workspace-write` | Codex only: `read-only`, `workspace-write` or `danger-full-access`. |
| `claude_binary`, `codex_binary` | `claude`, `codex` | The CLIs to run. |
| `allowed_tools` | `Read,Edit,Write,Grep,Glob,Bash(./validate.sh:*)` | Claude Code only: what the session may use. Claude Code also runs read-only shell commands without asking. |
| `timeout_s` | `7200` | Wall-clock limit for one call. |

## `feedback`

See [feedback.md](feedback.md) for what each choice shows.

| Field | Default | Meaning |
|---|---|---|
| `form` | `[state, relations]` | Any of `state` (numbers), `relations` (predicates), `visual` (stills); `[]` is the outcome only. |
| `spatial` | `parts` | `positions`, `frames` or `parts`. |
| `granularity` | `semantic` | `episode`, `motion` or `semantic`. |
| `max_episodes` | `6` | Episodes rendered in full: one per distinct way the batch failed, then one success. |
| `max_frames` | `16` | `visual` only: stills per batch, across all cameras, spent around the first failure. |
| `cameras` | `[]` | `visual` only: the cameras the stills come from; empty picks a scene camera and a wrist camera. |

## `skills`

See [skills.md](skills.md).

| Field | Default | Meaning |
|---|---|---|
| `path` | none | A library holding `skills/<name>/SKILL.md`. |
| `mode` | `none` | `none`, `listed` (descriptions only) or `full` (descriptions and source). |

## `loop`

| Field | Default | Meaning |
|---|---|---|
| `iterations` | `4` | Policies scored on train, counting the first one the agent writes. |
| `eval_every` | `2` | Score the held-out episodes every this many iterations, and always at the first and the last. |
| `perfect_streak` | `2` | Stop after this many training batches in a row with every episode a success. |
| `max_usd` | `15.0` | Stop before an iteration once the agent has cost this much. A Codex session reports no dollars. |
| `fix_rounds` | `2` | Times a rejected policy goes back to the agent with the errors before the round gives up. |

## `execution`

| Field | Default | Meaning |
|---|---|---|
| `gpu` | none | Sets `CUDA_VISIBLE_DEVICES` for the runner. |
| `device` | `cuda:0` | The device the runner simulates on. |
| `perception` | `oracle` | RoboSimStudio's perception mode for the policy's tools. |
| `motion` | `osc` | RoboSimStudio's motion mode. |
| `settle_steps` | `60` | Control steps the simulation keeps running after the graph finishes, so the evaluator scores a settled scene. |
| `max_steps` | `0` | Control steps per episode; 0 is the task's own budget. |
| `renderer` | `tiled` | The camera renderer for recorded video (`asl-rollout`, and training batches under the `visual` form). |
| `bus_timeout` | `900` | Seconds the policy may wait on the simulator. |
| `timeout_s` | `3600` | Wall-clock limit for one batch of episodes. |
