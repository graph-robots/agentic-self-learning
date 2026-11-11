# Skills

A skill library holds `skills/<name>/SKILL.md` in the Agent Skills format,
with the skill's scripts beside it. The front matter names the skill and says
what it is for; an optional `gap` block names the tools it uses and the exits
it can end in:

```yaml
---
name: proposing-side-grasps
description: Propose grasps that close across an object's narrow horizontal axis.
gap:
  allowed_tools: [sim.get_object_obb, robot.grasp_frame]
  exit_conditions:
    ok: ...
    no_candidate: ...
---
```

[open-robot-skills](https://github.com/graph-robots/open-robot-skills) is one
such library. Point a run at it:

```yaml
skills:
  path: ../open-robot-skills
  mode: full          # or listed
```

## What is offered

A skill is offered only when it can run in this task: every tool its scripts
call (each literal `ctx.tool("...")`) and every tool it declares must be in the
task's tools file, and no call may compute its tool name. Advertising a skill
that cannot run costs the agent a rejected round.

## The two modes

- `listed`: `SKILLS.md` lists each offered skill: its name, tools, exits and
  description. The library itself is off limits to the session.
- `full`: the same list, and each offered skill is copied into the workspace
  as `skills/<name>/`.

## How the agent uses one

The check accepts only `"skill": "generated"` subgraphs: a policy carries its
own code, and nothing is resolved from a registry at run time. So the agent
reuses a skill by reading it and writing what it needs into `workflow/scripts/`,
and names the skill it started from in the subgraph's or the workflow's
description. `SKILLS.md` says so.
