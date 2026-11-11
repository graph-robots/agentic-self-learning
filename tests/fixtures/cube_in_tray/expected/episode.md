# Execution feedback — iteration 0

Task: `cube_in_tray/base` — pick up the red cube and put it in the tray

What this feedback contains: outcome + simulation feedback: state, relations; once per episode (start → end); space written as positions, orientations and the assets' declared parts.

**Train result: 1/2 episodes succeeded (50%).**

Positions are world coordinates in metres [x, y, z]. Orientations are given as axis directions in world coordinates; an offset marked 'its own axes' is along the object's own box axes (long/mid/short). Parts are declared by each asset in its own frame (below).

Declared parts — the vocabulary the goal is written and scored in:
- `cube.body` — a grasp_box (the entity's own frame, metres)
- `cube.up` — a axis (the entity's own frame, metres)
- `tray.floor` — a face at [0, 0, 0.004] (the entity's own frame, metres)
- `tray.wall_nx` — a face at [-0.085, 0, 0.0225] (the entity's own frame, metres)
- `tray.wall_ny` — a face at [0, -0.065, 0.0225] (the entity's own frame, metres)
- `tray.wall_px` — a face at [0.085, 0, 0.0225] (the entity's own frame, metres)
- `tray.wall_py` — a face at [0, 0.065, 0.0225] (the entity's own frame, metres)

| episode | success | steps | ended |
|---|---|---|---|
| 0 | no | 1201 | truncated |
| 1 | YES | 919 | success |

**1 of 2 episodes exhausted ~1201 control steps with the task unfinished.** Successful episodes used 919–919 steps.


## Episode 0 — FAILURE, 1201 steps, ended: truncated

### Start → end of the episode
- cube moved 0.214 m: [0.590, -0.200, 0.770] → [0.574, -0.206, 0.984] (+213 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
- arm 0's hand moved 0.289 m to [0.574, -0.206, 0.985].
- cube `cube.up` 9° from world up.
- arm 0's hand hand frame axes x→[-0.87, -0.46, -0.18] y→[-0.46, +0.89, -0.03] z→[+0.18, +0.06, -0.98] (world); cube's centre in the hand frame [0.000, 0.000, 0.001].
- cube ended 0.143 m outside tray_inside's footprint in x-y.
- cube ended 0.189 m above tray_inside's height window.
- cube inside tray_inside: no.
- arm 0's fingers and cube came into contact.
- cube and table stopped touching.
- arm 0 grasped cube, and it moved with the hand.
- at the start: cube rests on table; `cube.up` points up.
- at the end: `cube.up` points up; arm 0's fingers are closed on cube.

## Episode 1 — SUCCESS, 919 steps, ended: success

### Start → end of the episode
- cube moved 0.187 m: [0.576, -0.125, 0.770] → [0.501, 0.046, 0.778] (+7 mm long, +142 mm mid, -122 mm short (its own axes)); at rest.
- cube `cube.up` 0° from world up.
- cube ended 0.000 m outside tray_inside's footprint in x-y.
- cube inside tray_inside: yes.
- cube and tray came into contact.
- cube and table stopped touching.
- cube entered tray_inside.
- at the start: cube rests on table; `cube.up` points up.
- at the end: cube is inside tray_inside; cube rests on tray; `cube.up` points up.