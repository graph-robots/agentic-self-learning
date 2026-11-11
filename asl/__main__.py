# SPDX-License-Identifier: Apache-2.0
"""Command line.

asl-run   --config CONFIG [--set key=value ...]            run the loop
asl-rollout --config CONFIG --graph DIR [--episodes SPEC]  run one policy, recording video
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import load_config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="asl-run", description="Run the self-learning loop on one task.")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override a config value")
    parser.add_argument("--run-dir", type=Path, default=None)
    args = parser.parse_args(argv)
    from .loop import Loop

    report = Loop(load_config(args.config, args.set), run_dir=args.run_dir).run()
    print(json.dumps({k: report[k] for k in ("train_curve", "eval_curve", "best_by_train", "agent_usd", "stopped")}))
    return 0


def rollout(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asl-rollout", description="Run one policy on a set of episodes, recording video."
    )
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--graph", required=True, type=Path, help="the policy directory (workflow.json + scripts/)")
    parser.add_argument("--episodes", default="", help="episode ids; defaults to the config's held-out episodes")
    parser.add_argument(
        "--out", type=Path, default=Path("outputs/rollout"), help="where the batch goes; an earlier rollout there is replaced"
    )
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    args = parser.parse_args(argv)
    from .runner import run_batch

    cfg = load_config(args.config, args.set)
    batch = run_batch(cfg, args.graph, args.episodes or cfg.eval_episodes, args.out, "rollout", record=True)
    print(f"{batch.successes}/{batch.n} succeeded -> {batch.run_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
