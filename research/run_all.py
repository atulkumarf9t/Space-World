"""One-command reproducibility runner for the DRIFT research substrate.

Runs the correctness gates (cross-language parity + env tests) and then every benchmark,
printing each section's output. `--quick` (default) uses small n for a fast full sweep;
`--full` uses larger n for publication-grade numbers.

Run: python research/run_all.py [--quick|--full]
"""

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PY = sys.executable


def run(label, args, gate=False):
    print("\n" + "=" * 70)
    print(f"  {label}")
    print("=" * 70)
    r = subprocess.run([PY, os.path.join(HERE, args[0])] + args[1:], cwd=ROOT)
    ok = r.returncode == 0
    if gate and not ok:
        print(f"\n!! correctness gate failed: {label}")
        sys.exit(1)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="larger n (publication-grade)")
    args = ap.parse_args()
    n = "60" if args.full else "30"
    pool = "200" if args.full else "80"

    # refresh JS reference for parity if node is available
    node = shutil.which("node")
    if node:
        print("[setup] regenerating JS parity reference (node gen_ref.mjs)")
        subprocess.run([node, os.path.join(HERE, "gen_ref.mjs")], cwd=ROOT)

    # correctness gates (must pass)
    run("Cross-language parity (Python == JS engine)", ["test_parity.py"], gate=True)
    run("Env / dataset / guard smoke tests", ["test_env.py"], gate=True)

    # benchmarks
    run("Baselines scorecard", ["baselines.py", "--n", n])
    run("A1 — instruction-following", ["a1_benchmark.py", "--n", n])
    run("A2 — shielded-RL ablation", ["a2_ablation.py", "--n", n])
    run("A3 — classical-vs-learned", ["a3_benchmark.py", "--n", n])
    run("D2 — curriculum + adversarial", ["d2_curriculum.py", "--n", n, "--pool", pool, "--topk", n])
    run("E1 — generative-world coupling", ["e1_coupling.py", "--n", n])
    run("E2 — reasoning faithfulness", ["e2_faithfulness.py", "--n", n])

    print("\n" + "=" * 70)
    print("  ALL SECTIONS COMPLETE  (parity + env gates passed)")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
