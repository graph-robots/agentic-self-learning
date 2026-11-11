# The paper's feedback conditions, and how this code differs from the study's

The paper's tasks are not part of this repository; see the
[project page](https://graph-robots.github.io/agentic-self-learning/) for them and
for the results. This page maps the paper's feedback conditions to configs,
and lists every known way this code differs from the harness the study ran.

## Conditions

The renderer (`asl/feedback/`) is the study's, and so is the fact extraction.
Rendered from the study's archived packets, it reproduces the study's
`FEEDBACK.md` byte for byte after the differences listed below.

| In the paper | Config (`feedback`) | Example config |
|---|---|---|
| Per episode | `granularity: episode` | [`episode.yaml`](../../examples/cube_in_tray/configs/episode.yaml) |
| Per motion | `granularity: motion` | [`motion.yaml`](../../examples/cube_in_tray/configs/motion.yaml) |
| Per skill | `granularity: semantic` (the default) | [`reference.yaml`](../../examples/cube_in_tray/configs/reference.yaml) |
| Outcome only | `form: []` | [`success_only.yaml`](../../examples/cube_in_tray/configs/success_only.yaml) |
| State + relations, world frame | `spatial: positions` | [`positions.yaml`](../../examples/cube_in_tray/configs/positions.yaml) |
| State + relations, object frames | `spatial: frames` | [`frames.yaml`](../../examples/cube_in_tray/configs/frames.yaml) |
| + part annotations | `spatial: parts` (the default) | [`reference.yaml`](../../examples/cube_in_tray/configs/reference.yaml) |
| Feedback form: state, relations, visual | `form: [state]`, `[relations]`, `[visual]` | [`state.yaml`](../../examples/cube_in_tray/configs/state.yaml), [`relations.yaml`](../../examples/cube_in_tray/configs/relations.yaml), [`visual.yaml`](../../examples/cube_in_tray/configs/visual.yaml) |

The paper's model comparison varies `agent` (`kind`, `model`,
`thinking_tokens`, `reasoning_effort`, and `env` for models served through an
Anthropic-compatible endpoint), and its skill study varies `skills`.

## Differences from the study's harness

- **Rendering.**
  - The outcome table has no per-object column: per-object scoring was
    specific to the study's benchmark. Episodes are scored whole.
  - There is no loop notice: the study's loop could revert a regressed
    policy to an earlier iterate; this loop does not.
  - A short batch's note does not quote the runner's exit code or log.
  - The history table says a rejected edit was refused by the check.
  - A graph cut off at the step limit is reported as having exhausted its
    steps; the study's outcome also counted it among the graphs that
    "raised nothing — your graph finished". The history says a past batch's
    graphs raised only where its outcome did; the study's history named the
    first node to record an error in each failed episode, including the one
    the step limit cut off.
- **Selection.** The study selected the delivered iterate by a validation
  split; this loop delivers the best training iterate (ties to the latest)
  and scores it on the held-out episodes.
- **Budgets.** The study ran 4 training, 5 validation and 10 held-out
  episodes per iteration; the example runs 6 and 6. Set `train_episodes`,
  `eval_episodes` and `loop` to match a study cell.
- **Sessions.** The study rebuilt the agent's workspace each iteration and
  gave it its history in the feedback; this loop also resumes one session, so
  the agent keeps its own context as well.
- **Prompts.** The briefs (`asl/prompts/`) are this repository's, shorter
  than the study's.
- **Skills.** The study shipped a skill library with a registry the runtime
  resolved; here a skill is copied into the policy (see
  [skills.md](skills.md)).
- **Stills.** The study rendered the visual form's stills with a path tracer;
  the default here is the `tiled` renderer (`execution.renderer`). The
  frames chosen are the same; their pixels differ.
- **Curriculum.** The paper's privileged-to-perception curriculum is not part
  of this code.
