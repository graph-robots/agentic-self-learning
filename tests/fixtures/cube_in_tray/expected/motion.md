# Execution feedback — iteration 0

Task: `cube_in_tray/base` — pick up the red cube and put it in the tray

What this feedback contains: outcome + simulation feedback: state, relations; per motion primitive (each simulation-stepping tool call); space written as positions, orientations and the assets' declared parts.

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
Across the batch: 8 motion calls per episode, 1037 steps spent inside them.


## Episode 0 — FAILURE, 1201 steps, ended: truncated

### At the start of the episode
- cube at [0.590, -0.200, 0.770]; `cube.up` 0° from world up.
- arm 0's hand at [0.627, -0.464, 1.103]; hand frame axes x→[-0.20, +0.00, -0.98] y→[+0.87, +0.45, -0.18] z→[+0.44, -0.89, -0.09] (world).
- arm 1's hand at [0.627, 0.156, 1.103]; hand frame axes x→[-0.20, +0.00, -0.98] y→[+0.87, +0.45, -0.18] z→[+0.44, -0.89, -0.09] (world).
- cube rests on table.
- `cube.up` points up.

### Motion 1 · `robot.open_gripper` · arm 0 · steps 1–83
- cube is 0.140 m from tray_inside.
- cube inside tray_inside: no.
### Motion 2 · `robot.execute_trajectory` · arm 0 → toward [0.590, -0.200, 0.870] · steps 88–181
- arm 0's hand moved 0.353 m to [0.591, -0.201, 0.870].
- ended 0.001 m from its commanded target [0.590, -0.200, 0.870]; 90° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0044}.
- arm 0's hand hand frame axes x→[-0.88, -0.47, -0.00] y→[-0.47, +0.88, -0.00] z→[+0.00, -0.00, -1.00] (world).
### Motion 3 · `robot.execute_trajectory` · arm 0 → toward [0.590, -0.200, 0.770] · steps 184–273
- arm 0's hand moved 0.099 m to [0.590, -0.200, 0.771].
- ended 0.001 m from its commanded target [0.590, -0.200, 0.770]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0062}.
### Motion 4 · `robot.close_gripper` · arm 0 · steps 274–396
- jaws closed at [0.590, -0.200, 0.770]; 0.001 m from cube's centre (world Δ [0.000, 0.000, 0.001]); offset +1 mm long (its own axes); aperture 20.3 mm.
- arm 0's fingers and cube came into contact.
- arm 0 grasped cube, and it moved with the hand.
- the close met cube.
- now arm 0's fingers are closed on cube.
### Motion 5 · `robot.go_to_pose_cartesian` · arm 0 → toward [0.590, -0.200, 0.800] · steps 397–427
- cube moved 0.028 m: [0.590, -0.200, 0.770] → [0.590, -0.200, 0.797] (+28 mm long (its own axes)); still moving.
- arm 0's hand moved 0.028 m to [0.590, -0.200, 0.798].
- ended 0.002 m from its commanded target [0.590, -0.200, 0.800]; 0° from the commanded orientation; tool-reported residuals {'remaining_distance': 0.0024}.
- cube `cube.up` 0° from world up.
- arm 0's hand cube's centre in the hand frame [0.000, -0.000, 0.001].
- cube and table stopped touching.
- no longer: cube rests on table.
### Motion 6 · `robot.go_to_pose_cartesian` · arm 0 → toward [0.590, -0.200, 1.103] · steps 432–1201 · interrupted
- cube moved 0.187 m: [0.590, -0.200, 0.797] → [0.574, -0.206, 0.984] (+186 mm long, +3 mm mid, -17 mm short (its own axes)); turned 9°; at rest.
- arm 0's hand moved 0.188 m to [0.574, -0.206, 0.985].
- ended 0.119 m from its commanded target [0.590, -0.200, 1.103]; 11° from the commanded orientation.
- cube `cube.up` 9° from world up.
- arm 0's hand hand frame axes x→[-0.87, -0.46, -0.18] y→[-0.46, +0.89, -0.03] z→[+0.18, +0.06, -0.98] (world); cube's centre in the hand frame [0.000, 0.000, 0.001].
- cube is 0.237 m from tray_inside.
- `robot.go_to_pose_cartesian` ended with an error: episode ended before the tool returned

### At the end of the episode
- cube at [0.574, -0.206, 0.984]; `cube.up` 9° from world up.
- arm 0's hand at [0.574, -0.206, 0.985]; hand frame axes x→[-0.87, -0.46, -0.18] y→[-0.46, +0.89, -0.03] z→[+0.18, +0.06, -0.98] (world); cube's centre in the hand frame [0.000, 0.000, 0.001].
- cube ended 0.143 m outside tray_inside's footprint in x-y.
- cube ended 0.189 m above tray_inside's height window.
- `cube.up` points up.
- arm 0's fingers are closed on cube.
- cube inside tray_inside: no.

## Episode 1 — SUCCESS, 919 steps, ended: success

### At the start of the episode
- cube at [0.576, -0.125, 0.770]; `cube.up` 0° from world up.
- arm 0's hand at [0.627, -0.464, 1.103]; hand frame axes x→[-0.20, +0.00, -0.98] y→[+0.87, +0.45, -0.18] z→[+0.44, -0.89, -0.09] (world).
- arm 1's hand at [0.627, 0.156, 1.103]; hand frame axes x→[-0.20, +0.00, -0.98] y→[+0.87, +0.45, -0.18] z→[+0.44, -0.89, -0.09] (world).
- cube rests on table.
- `cube.up` points up.

### Motion 1 · `robot.open_gripper` · arm 0 · steps 1–83
- cube is 0.127 m from tray_inside.
- cube inside tray_inside: no.
### Motion 2 · `robot.execute_trajectory` · arm 0 → toward [0.576, -0.125, 0.840] · steps 88–181
- arm 0's hand moved 0.431 m to [0.577, -0.126, 0.840].
- ended 0.001 m from its commanded target [0.576, -0.125, 0.840]; 90° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0041}.
- arm 0's hand hand frame axes x→[-0.96, +0.30, -0.01] y→[+0.30, +0.96, +0.00] z→[+0.01, -0.00, -1.00] (world).
### Motion 3 · `robot.execute_trajectory` · arm 0 → toward [0.576, -0.125, 0.770] · steps 184–271
- arm 0's hand moved 0.069 m to [0.576, -0.126, 0.771].
- ended 0.002 m from its commanded target [0.576, -0.125, 0.770]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.006}.
### Motion 4 · `robot.close_gripper` · arm 0 · steps 272–394
- jaws closed at [0.577, -0.125, 0.770]; 0.001 m from cube's centre (world Δ [0.000, 0.000, 0.001]); offset +1 mm long (its own axes); aperture 20.3 mm.
- arm 0's fingers and cube came into contact.
- arm 0 grasped cube, and it moved with the hand.
- the close met cube.
- now arm 0's fingers are closed on cube.
### Motion 5 · `robot.execute_trajectory` · arm 0 → toward [0.577, -0.125, 0.864] · steps 397–488
- cube moved 0.092 m: [0.576, -0.125, 0.770] → [0.576, -0.125, 0.862] (+92 mm long, +1 mm mid (its own axes)); at rest.
- arm 0's hand moved 0.092 m to [0.577, -0.125, 0.862].
- ended 0.001 m from its commanded target [0.577, -0.125, 0.864]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0046}.
- cube `cube.up` 0° from world up.
- arm 0's hand cube's centre in the hand frame [0.000, 0.000, 0.001].
- cube is 0.143 m from tray_inside.
- cube and table stopped touching.
- no longer: cube rests on table.
### Motion 6 · `robot.execute_trajectory` · arm 0 → toward [0.502, 0.046, 0.864] · steps 495–590
- cube moved 0.186 m: [0.576, -0.125, 0.862] → [0.502, 0.045, 0.863] (+1 mm long, +141 mm mid, -122 mm short (its own axes)); turned 1°; at rest.
- arm 0's hand moved 0.186 m to [0.502, 0.045, 0.863].
- ended 0.001 m from its commanded target [0.502, 0.046, 0.864]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0057}.
- cube `cube.up` 0° from world up.
- arm 0's hand cube's centre in the hand frame [-0.000, 0.000, 0.001].
- cube is 0.068 m from tray_inside.
- now cube is above tray_inside, outside it.
### Motion 7 · `robot.execute_trajectory` · arm 0 → toward [0.501, 0.046, 0.797] · steps 595–682
- cube moved 0.066 m: [0.502, 0.045, 0.863] → [0.501, 0.046, 0.797] (-66 mm long (its own axes)); at rest.
- arm 0's hand moved 0.065 m to [0.501, 0.046, 0.798].
- ended 0.001 m from its commanded target [0.501, 0.046, 0.797]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0058}.
- cube `cube.up` 0° from world up.
- arm 0's hand cube's centre in the hand frame [-0.000, -0.000, 0.001].
- cube is 0.002 m from tray_inside.
### Motion 8 · `robot.open_gripper` · arm 0 → toward [0.501, 0.046, 0.847] · steps 682–764
- cube moved 0.019 m: [0.501, 0.046, 0.797] → [0.501, 0.046, 0.778] (-19 mm long (its own axes)); at rest.
- ended 0.050 m from its commanded target [0.501, 0.046, 0.847]; 0° from the commanded orientation.
- cube `cube.up` 0° from world up.
- cube inside tray_inside: yes.
- cube and tray came into contact.
- arm 0's fingers and cube stopped touching.
- arm 0 let go of cube.
- cube entered tray_inside.
- now cube is inside tray_inside.
- now cube rests on tray.
- no longer: cube is above tray_inside, outside it.
- no longer: arm 0's fingers are closed on cube.
### Motion 9 · `robot.execute_trajectory` · arm 0 → toward [0.501, 0.046, 0.847] · steps 767–854
- arm 0's hand moved 0.049 m to [0.501, 0.046, 0.846].
- ended 0.001 m from its commanded target [0.501, 0.046, 0.847]; 0° from the commanded orientation; tool-reported residuals {'final_tracking_error_rad': 0.0055}.
### Motion 10 · `robot.go_home` · arm 0 · steps 856–919 · interrupted
- arm 0's hand moved 0.585 m to [0.627, -0.464, 1.103].
- arm 0's hand hand frame axes x→[-0.20, -0.00, -0.98] y→[+0.87, +0.45, -0.18] z→[+0.44, -0.89, -0.09] (world).
- `robot.go_home` ended with an error: episode ended before the tool returned

### At the end of the episode
- cube at [0.501, 0.046, 0.778]; `cube.up` 0° from world up.
- cube ended 0.000 m outside tray_inside's footprint in x-y.
- cube is inside tray_inside.
- cube rests on tray.
- `cube.up` points up.
- cube inside tray_inside: yes.