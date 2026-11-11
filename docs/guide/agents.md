# Agents

The loop runs one agent session per run and resumes it every iteration, so
the agent keeps its own memory of what it tried. Before each call the loop
rewrites the session's workspace:

| File | What it is |
|---|---|
| `INSTRUCTIONS.md` | The brief for this round: write, improve, or fix a rejected policy |
| `WORKFLOW_FORMAT.md` | The workflow format |
| `TOOLS.md`, `tools.json` | Every tool the policy may call |
| `FEEDBACK.md` | What the last training batch did, for the run's feedback condition |
| `frames/` | The stills `FEEDBACK.md` cites (`visual` form only) |
| `SKILLS.md`, `skills/` | The skill library, when the run has one |
| `workflow/` | The policy; the only thing the agent edits |
| `validate.sh` | The check, the one command the agent is meant to run |

## What the agent may read

The agent is meant to work from its workspace alone. The loop puts these
paths off limits to it:
- the run directory, where the held-out results are written;
- the task root: the task document, its goal and its sampler;
- the output root, and every path in `off_limits`;
- under `skills.mode: listed`, the skill library.

These are rules for the agent's tools, not a sandbox, and nothing else is
denied. The evaluator, for one, ships with RoboSimStudio, in its checkout and
in the environment's installed packages; add those to `off_limits` if a run
must not see them. The example's config denies its own directory (its
README states the goal, and `policy/` is a solution) and the tests' recorded
batch.

And the policy is code the agent writes. The check, `./validate.sh` and the
loop's own, runs none of it: it reads `workflow.json` and parses each script,
and runs gap's validator without letting it import a script, since importing
runs the script's top-level code. Every training and held-out batch runs the
whole policy, as you, with your privileges: a policy can read anything you
can and leave it where the agent will look next.

So the held-out results, the task's source and the evaluator stay unseen
only as long as the agent keeps to the rules. Holding a model you do not
trust to them takes OS-level isolation, which this repository does not
provide: run the agent's session in a container or VM that holds only the
workspace, and each batch in one that holds only the policy, the task and the
batch's own output directory. Even then a batch's policy runs in the same
process as the evaluator that scores it.

## Claude Code (`kind: claude_code`)

`claude -p` with `--session-id` on the first call and `--resume` after.
`agent.allowed_tools` grants the file tools and `./validate.sh`; Claude Code
also runs read-only shell commands (`ls`, `cat`, `grep`, ...) without asking,
whatever the allowed tools say. Deny rules in the workspace's
`.claude/settings.json` cover the off-limits paths above for the Read, Grep,
Glob, Edit and Write tools, and keep the session from editing `validate.sh`
or the settings file; deny rules take precedence over the allowed tools.
They are written for the file tools: a read-only shell command is not
guaranteed to honour them. `./validate.sh` runs none of the policy's code,
and Python does not look for modules in the workspace when it runs, so no
file the session writes runs when the check does.

`agent.thinking_tokens` sets `MAX_THINKING_TOKENS`. The cost of each call is
the difference between the session's cumulative totals before and after it.

### Other models through an Anthropic-compatible endpoint

Claude Code can talk to any endpoint that speaks the Anthropic Messages API.
Set it per run in `agent.env`; values are expanded from your environment when
the session starts and are never written into the run directory:

```yaml
agent:
  kind: claude_code
  model: <the endpoint's model id>
  env:
    ANTHROPIC_BASE_URL: https://your-endpoint.example
    ANTHROPIC_AUTH_TOKEN: $YOUR_KEY_VARIABLE
    ANTHROPIC_API_KEY: ""
```

The cost Claude Code reports for such a model is computed at Claude's rates;
price the run from its token counts instead. `report.json`'s `agent_tokens`
sums each call's `usage`: input, cache creation, cache reads and output.

## Codex (`kind: codex`)

`codex exec --json` on the first call and `codex exec resume <thread>` after,
with the same workspace. Codex reads `AGENTS.md`, which the loop writes with
the same rules. `agent.reasoning_effort` sets `model_reasoning_effort`. A
ChatGPT login reports no dollars, so `loop.max_usd` never stops the run;
`report.json` records its token counts in `agent_tokens`.

| `codex_sandbox` | Writes outside the workspace | Reads outside the workspace | Use it |
|---|---|---|---|
| `read-only` | refused | allowed | The agent cannot edit `workflow/`; not useful for the loop |
| `workspace-write` (default) | refused | allowed | Everywhere Codex's sandbox starts |
| `danger-full-access` | allowed | allowed | Only inside a container or VM you control, on hosts where Codex's own sandbox cannot start |

No sandbox mode stops reads, so the off-limits paths are checked by audit
instead: after every call, each command the session ran and each file it
changed is checked for an off-limits path. A hit is written to
`offlimits_hits.json` beside the transcript and printed, and that iteration
should be discarded. A command's output is not audited (`cat AGENTS.md`
prints the very paths it forbids), and neither is what a program the session
runs, the policy's own scripts included, reads on its own.
