# The feedback fixture

Two episodes of the example's measured run (`examples/cube_in_tray`, reference
condition): a failure from iteration 0's training batch (the lift that stalls
until the episode runs out of steps) and a success from iteration 2's. Cut by

```bash
uv run python tests/make_fixture.py <run>/iterations/k000/train <run>/iterations/k002/train
```

which keeps only what the feedback reads, checks that the cut renders every
condition exactly as the original batch does, and writes `expected/`: the
feedback under each condition but `visual`. `tests/test_feedback_fixture.py`
renders the fixture and compares.
