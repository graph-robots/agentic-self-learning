# Execution feedback — iteration 0

Task: `cube_in_tray/base` — pick up the red cube and put it in the tray

What this feedback contains: outcome + simulation feedback: relations; per named graph step (each node of your workflow); space written as positions, orientations and the assets' declared parts.

**Train result: 1/2 episodes succeeded (50%).**

Positions are world coordinates in metres [x, y, z]. Orientations are given as axis directions in world coordinates; an offset marked 'its own axes' is along the object's own box axes (long/mid/short). Parts are declared by each asset in its own frame (below).

Declared parts — the vocabulary the goal is written and scored in:
- `cube.body` — a grasp_box
- `cube.up` — a axis
- `tray.floor` — a face
- `tray.wall_nx` — a face
- `tray.wall_ny` — a face
- `tray.wall_px` — a face
- `tray.wall_py` — a face

| episode | success | steps | ended |
|---|---|---|---|
| 0 | no | 1201 | truncated |
| 1 | YES | 919 | success |

**1 of 2 episodes exhausted ~1201 control steps with the task unfinished.** Successful episodes used 919–919 steps.


## Episode 0 — FAILURE, 1201 steps, ended: truncated

### At the start of the episode
- cube rests on table.
- `cube.up` points up.


### `pick_sg`
- **`pick_sg.reset`** (script, ok, 0.6 s)
  - cube inside tray_inside: no.
- **`pick_sg.close`** (script, ok, 1.5 s)
  - arm 0's fingers and cube came into contact.
  - arm 0 grasped cube, and it moved with the hand.
  - the close met cube.
  - now arm 0's fingers are closed on cube.
- **`pick_sg.lift`** (script, error, 18.5 s) — raised: Node 'pick_sg.lift' failed: BusClosed: the simulation bus closed: the episode ended
  - cube and table stopped touching.
  - no longer: cube rests on table.
  - `robot.go_to_pose_cartesian` ended with an error: episode ended before the tool returned

### At the end of the episode
- `cube.up` points up.
- arm 0's fingers are closed on cube.
- cube inside tray_inside: no.

## Episode 1 — SUCCESS, 919 steps, ended: success

### At the start of the episode
- cube rests on table.
- `cube.up` points up.


### `pick_sg`
- **`pick_sg.reset`** (script, ok, 0.7 s)
  - cube inside tray_inside: no.
- **`pick_sg.close`** (script, ok, 1.5 s)
  - arm 0's fingers and cube came into contact.
  - arm 0 grasped cube, and it moved with the hand.
  - the close met cube.
  - now arm 0's fingers are closed on cube.
- **`pick_sg.lift`** (script, ok, 1.2 s)
  - cube and table stopped touching.
  - no longer: cube rests on table.

### `place_sg`
- **`place_sg.carry`** (script, ok, 2.1 s)
  - now cube is above tray_inside, outside it.
- **`place_sg.release`** (script, ok, 2.8 s)
  - cube inside tray_inside: yes.
  - cube and tray came into contact.
  - arm 0's fingers and cube stopped touching.
  - arm 0 let go of cube.
  - cube entered tray_inside.
  - now cube is inside tray_inside.
  - now cube rests on tray.
  - no longer: cube is above tray_inside, outside it.
  - no longer: arm 0's fingers are closed on cube.

### `verify_sg`
- **`verify_sg.clear`** (script, error, 7.8 s) — raised: Node 'verify_sg.clear' failed: BusClosed: the simulation bus closed: the episode ended
  - `robot.go_home` ended with an error: episode ended before the tool returned

### At the end of the episode
- cube is inside tray_inside.
- cube rests on tray.
- `cube.up` points up.
- cube inside tray_inside: yes.