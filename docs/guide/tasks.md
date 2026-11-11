# A task of your own

The loop runs any RoboSimStudio task the runner (`scripts/bench_run.py`) can
run as a graph. It needs three things beside each other, as in
[`examples/cube_in_tray`](../../examples/cube_in_tray):

1. **A task directory**: `<task_root>/<suite>/<variant>.task`, RoboSimStudio's
   task document (scene, objects, goal, episode sampler), plus any Python it
   names (asset records, custom entities, samplers). See RoboSimStudio's
   [task examples](https://github.com/robosimstudio/robosimstudio/tree/main/examples/06_tasks).
2. **A tools file**: the tools the policy may call, each with its parameters,
   a summary and what it returns. The agent reads it as `TOOLS.md`; the check
   refuses any call to a tool that is not in it.
3. **A config**: see [configuration.md](configuration.md).

## What the feedback needs from the task

- **The evaluator's metrics.** Goals are read from the evaluator's own metric
  keys, never from the task's name. Five metric shapes are graded beyond a
  verdict (distance to the goal at the end, the closest approach during the
  episode, whether the goal was reached and lost):

  | Shape | Keys |
  |---|---|
  | containment | `containment/<object>/<region>` |
  | enclosure (a loop around a rod) | `encloses/<a>/<b>` with `goal.*` groups |
  | threaded (a rod through a fixed loop) | `threaded/<loop>/<rod>` with `goal.*` groups |
  | insertion | `insertion/<part>/<bore>` with `goal.*` groups |
  | fraction | `<name>_fraction` scalars paired with `goal.N` verdicts |

  Other keys are left unrendered; the outcome is still shown.
- **Regions** the task declares (a goal region inside a container) give the
  predicates "inside", "partly inside" and "above, outside it".
- **Parts.** `spatial: parts` names the parts each asset declares as
  `FeatureSpec`s on its `AssetRecord`, in the asset's own frame. RoboSimStudio
  writes them into each episode's capture manifest. What the feedback reads:

  | Payload | Used for |
  |---|---|
  | `center: [x, y, z]` | The part's position: listed with the part, and the point a close is measured against ("nearest declared part") |
  | `axis: [[x, y, z], [x, y, z]]` | A rod's two ends: listed, and their midpoint used as above |
  | `axis: [dx, dy, dz]` with `mouth` | A cavity's direction and opening |
  | `direction` on a feature of kind `axis` | The part's angle from world up, tracked over the episode ("points up", "is on its side", "is inverted") |
  | numeric scalars (`radius`, `inner_r`, `depth`, ...) | Listed with the part |

  With no declared parts, `spatial: parts` reads like `frames`, and the loop
  logs a warning. The example declares a `face` per tray box and the cube's
  `body` grasp box and `up` axis; see its [`records.py`](../../examples/cube_in_tray/tasks/cube_in_tray/records.py).
- **Node names.** `granularity: semantic` reports per node of the agent's own
  workflow, from the spans RoboSimStudio records with the node that made each
  tool call. Nothing is needed from the task.
- **Cameras.** The `visual` form takes stills from the task's cameras; set
  `feedback.cameras` to choose them.
