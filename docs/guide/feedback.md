# Feedback conditions

After every training batch the agent reads one file, `FEEDBACK.md`. What is in
it is set by the config's `feedback` block: a **form**, a **spatial**
representation and a **granularity**. This page shows one batch under each.

Every condition is a view of the same record: `iterations/kNNN/feedback.json`
holds every fact the loop derived from the batch, whatever the agent was
shown, and `FEEDBACK.md` is that record rendered for the run's condition. To
render a saved batch under another condition:

```bash
uv run asl-feedback outputs/<name>/<stamp>/iterations/k000 --form relations --granularity motion
```

The `visual` form is the exception: its stills come from video, which is
recorded only in a run whose own `form` includes `visual`, and they are taken
at that run's granularity. A saved batch has stills to show under `visual`
only if it came from such a run and is rendered at the same granularity;
`asl-feedback` warns when there are none.

The excerpts below are all from iteration 0 of the example's measured run
([`examples/cube_in_tray`](../../examples/cube_in_tray)). Its first policy
grasped the cube, then tried to lift it to the arm's starting height, which
the arm cannot reach while holding the cube. The move stalled until the
episode ran out of control steps, in all six training episodes.

## What every condition shows

The outcome is not simulation feedback; every condition shows it, including
`form: []`:

```markdown
**Train result: 0/6 episodes succeeded (0%).**

| episode | success | steps | ended |
|---|---|---|---|
| 0 | no | 1201 | truncated |
| 1 | no | 1200 | truncated |
...

**6 of 6 episodes exhausted ~1201 control steps with the task unfinished.**
```

Also in every condition:
- each episode's ending;
- the error and node at which the policy's graph raised, when the graph itself
  raised. A graph cut off because the episode ran out of control steps did not
  raise, and neither did one that carried on past a node's error; a failed
  episode whose graph ran to its end is counted as "raised nothing — your
  graph finished and the goal was not met". The node that was cut off, and
  the error it recorded as the episode ended, show only in the per-unit
  blocks the other forms add, as in the `pick_sg.lift` excerpts below;
- a history of earlier iterations: the train rate, how large each edit was,
  where each earlier batch's graphs raised (in the same terms as the
  outcome: the batch above reads "6 ran out of control steps without
  raising"), and the agent's own summary of its last edit, marked unverified.

What the history adds about past behaviour follows the condition.

The evaluator's own metrics and the held-out results are never shown.

## Form: what beyond the outcome

| `form` | Shows |
|---|---|
| `[]` | Nothing more: the outcome only. |
| `[state]` | Numbers: positions, distances, offsets, commanded against achieved. |
| `[relations]` | Predicates: inside, above, rests on, grasped, came into contact, goal met. No numbers. |
| `[visual]` | Stills of the recorded video at unit boundaries, where a unit starts and ends: up to `max_frames` (16) per batch across all cameras, taken around the first failure first and spreading outward; cited by file name. |
| `[state, relations]` | Both (the default). |

The moment the cube is lifted off the table, under `[relations]`:

```markdown
- **`pick_sg.lift`** (script, error, 18.5 s) — raised: Node 'pick_sg.lift' failed: BusClosed: the simulation bus closed: the episode ended
  - cube and table stopped touching.
  - no longer: cube rests on table.
  - `robot.go_to_pose_cartesian` ended with an error: episode ended before the tool returned
```

## Spatial: how space is written

The same moment under `[state, relations]`, with each spatial setting.

**`positions`**: world positions of whole objects, no orientations, no parts.

```markdown
  - cube moved 0.215 m: [0.590, -0.200, 0.770] → [0.574, -0.206, 0.984]; at rest.
  - arm 0's hand moved 0.215 m to [0.574, -0.206, 0.985].
  - `robot.go_to_pose_cartesian`: ended 0.002 m from its commanded target [0.590, -0.200, 0.800]; tool-reported residuals {'remaining_distance': 0.0024}.
  - `robot.go_to_pose_cartesian`: ended 0.119 m from its commanded target [0.590, -0.200, 1.103].
  - cube is 0.237 m from tray_inside.
```

**`frames`** adds orientations and each object's own axes: how far it turned,
where the hand's axes point, and where the held cube sits in the hand's frame.

```markdown
  - cube moved 0.215 m: [0.590, -0.200, 0.770] → [0.574, -0.206, 0.984] (+214 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
  - `robot.go_to_pose_cartesian`: ended 0.119 m from its commanded target [0.590, -0.200, 1.103]; 11° from the commanded orientation.
  - arm 0's hand hand frame axes x→[-0.87, -0.46, -0.18] y→[-0.46, +0.89, -0.03] z→[+0.18, +0.06, -0.98] (world); cube's centre in the hand frame [0.000, 0.000, 0.001].
```

**`parts`** (the default) adds the parts each asset declares, listed once at
the top, and facts stated in them:

```markdown
Declared parts — the vocabulary the goal is written and scored in:
- `cube.body` — a grasp_box (the entity's own frame, metres)
- `cube.up` — a axis (the entity's own frame, metres)
- `tray.floor` — a face at [0, 0, 0.004] (the entity's own frame, metres)
- `tray.wall_nx` — a face at [-0.085, 0, 0.0225] (the entity's own frame, metres)
...

  - cube `cube.up` 9° from world up.
```

A task gets the `parts` vocabulary by declaring features on its assets; see
[tasks.md](tasks.md). Without declared parts, `parts` reads like `frames`.

## Granularity: when

**`episode`**: one block from start to end. Nothing says which step did what.

```markdown
### Start → end of the episode
- cube moved 0.214 m: [0.590, -0.200, 0.770] → [0.574, -0.206, 0.984] (+213 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
- arm 0's hand moved 0.289 m to [0.574, -0.206, 0.985].
- cube ended 0.143 m outside tray_inside's footprint in x-y.
- cube ended 0.189 m above tray_inside's height window.
- arm 0 grasped cube, and it moved with the hand.
```

**`motion`**: one block per tool call that stepped the simulation, named by
the tool and its target, never by the policy's own node names.

```markdown
### Motion 5 · `robot.go_to_pose_cartesian` · arm 0 → toward [0.590, -0.200, 0.800] · steps 397–427
- cube moved 0.028 m: [0.590, -0.200, 0.770] → [0.590, -0.200, 0.797] (+28 mm long (its own axes)); still moving.
- ended 0.002 m from its commanded target [0.590, -0.200, 0.800]; 0° from the commanded orientation; tool-reported residuals {'remaining_distance': 0.0024}.
- cube and table stopped touching.
### Motion 6 · `robot.go_to_pose_cartesian` · arm 0 → toward [0.590, -0.200, 1.103] · steps 432–1201 · interrupted
- cube moved 0.187 m: [0.590, -0.200, 0.797] → [0.574, -0.206, 0.984] (+186 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
- ended 0.119 m from its commanded target [0.590, -0.200, 1.103]; 11° from the commanded orientation.
```

**`semantic`** (the default): one block per node of the agent's own workflow,
under its own names, grouped by subgraph. Each block includes:
- the node's status and what it returned;
- roughly how many control steps it took;
- the error it raised;
- what changed while it ran.

```markdown
### `pick_sg`
- **`pick_sg.close`** (script, ok, 1.5 s) — returned position=0.4259330630302429, note=closed to 0.426, expected ~0.426, ~steps=68
  - jaws closed at [0.590, -0.200, 0.770]; 0.001 m from cube's centre (world Δ [0.000, 0.000, 0.001]); offset +1 mm long (its own axes); aperture 20.3 mm.
  - arm 0 grasped cube, and it moved with the hand.
- **`pick_sg.lift`** (script, error, 18.5 s) — returned ~steps=855 — raised: Node 'pick_sg.lift' failed: BusClosed: the simulation bus closed: the episode ended
  - cube moved 0.215 m: [0.590, -0.200, 0.770] → [0.574, -0.206, 0.984] (+214 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
  - `robot.go_to_pose_cartesian`: ended 0.119 m from its commanded target [0.590, -0.200, 1.103]; 11° from the commanded orientation.
```

Anything a node returns shows up here, so a policy can report what it wants
to read next time (a measured offset, which branch it took, how many retries).

## Which episodes are shown

The batch's failures are grouped by:
- the node they stopped at;
- how they ended;
- which goals they met.

The first episode of each group is rendered in full (up to
`feedback.max_episodes`, largest group first), then one success. The other
members of each group are listed in a short table. A batch whose units
exceed 40 per episode keeps the start, the end, and the stretch around the
failure.

## Conventions

- Positions are world coordinates in metres, `[x, y, z]`, z up.
- "Its own axes" orders an object's box axes longest first: long, mid, short.
- A motion is one tool call that stepped the simulation; tools that only read
  state are not motions.
- Distances to a goal are the evaluator's own geometry. For containment that
  is the distance to the region's footprint in x-y, and above or below its
  height window.
