"""End-to-end training example against the DRIFT env.

  - BC  : behavior cloning a small MLP from the oracle dataset (obs -> Δv).
  - PPO : from-scratch clipped PPO (torch) training on the env reward.
Then evaluates BC, PPO, oracle, and random on a held-out test split (regret vs par).

Run: python research/train.py [--ppo-updates 50] [--eval-n 60]
"""

import argparse
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import torch
import torch.nn as nn

from drift_env.env import DriftEnv, encode_obs, OBS_DIM
from drift_env.scenarios import generate_scenario, generate_batch
from drift_env.policies import optimal_policy, random_policy
from drift_env.metrics import aggregate

torch.manual_seed(0)
np.random.seed(0)
BUDGET = 12.0
DEV = "cpu"


def mlp(out, last=None):
    layers = [nn.Linear(OBS_DIM, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, out)]
    if last:
        layers.append(last)
    return nn.Sequential(*layers)


# ----------------------------- Behavior cloning -----------------------------
def train_bc(path, epochs=300):
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    X = torch.tensor([r["obs"] for r in rows], dtype=torch.float32)
    y = torch.tensor([[r["action_dv"]] for r in rows], dtype=torch.float32)
    net = mlp(1, nn.Softplus())  # Δv >= 0
    opt = torch.optim.Adam(net.parameters(), lr=2e-3)
    lossf = nn.MSELoss()
    for e in range(epochs):
        opt.zero_grad()
        loss = lossf(net(X), y)
        loss.backward()
        opt.step()
    print(f"  BC trained on {len(rows)} rows, final MSE {loss.item():.4f}")
    return net


def bc_policy(net):
    def decide(o):
        vec = torch.tensor(encode_obs(o, BUDGET), dtype=torch.float32)
        dv = float(net(vec).item())
        if dv < 0.05:
            return {"type": "coast"}
        return {"type": "burn", "dir": o["worstBurnDir"], "dv": dv}
    return {"name": "bc", "decide": decide}


# ----------------------------- PPO (from scratch) ---------------------------
class ActorCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.pi = mlp(1, nn.Sigmoid())     # mean action in (0,1)
        self.v = mlp(1)
        self.log_std = nn.Parameter(torch.tensor([-0.3]))

    def value(self, x):
        return self.v(x).squeeze(-1)

    def dist(self, x):
        mu = self.pi(x).squeeze(-1)
        return torch.distributions.Normal(mu, self.log_std.exp().clamp(0.1, 1.0))


# Warm-start the PPO actor by cloning the oracle (normalized Δv); PPO then fine-tunes.
def pretrain_actor(ac, path, steps=400):
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    X = torch.tensor([r["obs"] for r in rows], dtype=torch.float32)
    a = torch.tensor([[min(max(r["action_dv"] / BUDGET, 0.0), 1.0)] for r in rows], dtype=torch.float32)
    opt = torch.optim.Adam(ac.pi.parameters(), lr=2e-3)
    lossf = nn.MSELoss()
    for _ in range(steps):
        opt.zero_grad()
        loss = lossf(ac.pi(X), a)
        loss.backward()
        opt.step()
    print(f"  actor warm-started from oracle (clone MSE {loss.item():.4f})")


# Reward that makes "burn when needed" clearly worth it (avoids the coast local optimum).
PPO_REWARD = dict(dv_cost=0.5, resolved_bonus=20.0, fail_penalty=20.0, step_penalty=0.0)


def rollout(ac, n_eps, seed0, max_steps=50):
    env = DriftEnv(scenario_fn=generate_scenario, max_steps=max_steps, reward="shaped", reward_kwargs=PPO_REWARD)
    O, A, LP, R, V, D = [], [], [], [], [], []
    ep_returns = []
    for k in range(n_eps):
        obs, _ = env.reset(seed=seed0 + k)
        done = False
        ep_r = 0.0
        while not done:
            x = torch.tensor(obs, dtype=torch.float32)
            with torch.no_grad():
                dist = ac.dist(x)
                a = dist.sample()
                logp = dist.log_prob(a)
                v = ac.value(x)
            act = float(a.clamp(0, 1).item())
            nobs, r, term, trunc, _ = env.step([act])
            O.append(obs); A.append(act); LP.append(float(logp)); R.append(r); V.append(float(v)); D.append(term or trunc)
            obs = nobs; ep_r += r; done = term or trunc
        ep_returns.append(ep_r)
    return (np.array(O, dtype=np.float32), np.array(A, dtype=np.float32), np.array(LP, dtype=np.float32),
            np.array(R, dtype=np.float32), np.array(V, dtype=np.float32), np.array(D, dtype=bool), float(np.mean(ep_returns)))


def gae(R, V, D, gamma=0.99, lam=0.95):
    adv = np.zeros_like(R)
    last = 0.0
    for t in reversed(range(len(R))):
        nonterm = 0.0 if D[t] else 1.0
        nextv = V[t + 1] if (t + 1 < len(R) and not D[t]) else 0.0
        delta = R[t] + gamma * nextv * nonterm - V[t]
        last = delta + gamma * lam * nonterm * last
        adv[t] = last
    return adv, adv + V


def _score(agg):
    # higher is better: success first, then low regret
    return agg["success_pct"] - 0.05 * ((agg["mean_regret"] or 5.0))


def train_ppo(updates=40, eps_per=24, clip=0.2, epochs=4, warm_start=None, val_scenarios=None):
    import copy
    ac = ActorCritic()
    if warm_start:
        pretrain_actor(ac, warm_start)
    opt = torch.optim.Adam(ac.parameters(), lr=3e-4)
    curve = []
    best_state, best_score = copy.deepcopy(ac.state_dict()), -1e9
    if val_scenarios:  # score the warm-started policy before any fine-tuning
        best_score = _score(evaluate(ppo_policy(ac), val_scenarios))
    for u in range(updates):
        O, A, LP, R, V, D, meanret = rollout(ac, eps_per, seed0=1000 + u * eps_per)
        adv, ret = gae(R, V, D)
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        Ot = torch.tensor(O); At = torch.tensor(A); LPt = torch.tensor(LP)
        advt = torch.tensor(adv, dtype=torch.float32); rett = torch.tensor(ret, dtype=torch.float32)
        for _ in range(epochs):
            dist = ac.dist(Ot)
            logp = dist.log_prob(At)
            ratio = (logp - LPt).exp()
            l_clip = -torch.min(ratio * advt, ratio.clamp(1 - clip, 1 + clip) * advt).mean()
            l_v = ((ac.value(Ot) - rett) ** 2).mean()
            loss = l_clip + 0.5 * l_v - 0.005 * dist.entropy().mean()
            opt.zero_grad(); loss.backward(); opt.step()
        curve.append(meanret)
        if val_scenarios and (u + 1) % 5 == 0:
            sc = _score(evaluate(ppo_policy(ac), val_scenarios))
            if sc > best_score:
                best_score = sc
                best_state = copy.deepcopy(ac.state_dict())
        if (u + 1) % 10 == 0:
            print(f"  PPO update {u+1}/{updates}  mean return {meanret:7.2f}")
    ac.load_state_dict(best_state)  # report the best validation checkpoint
    return ac, curve


def ppo_policy(ac):
    def decide(o):
        x = torch.tensor(encode_obs(o, BUDGET), dtype=torch.float32)
        with torch.no_grad():
            a = float(ac.pi(x).clamp(0, 1).item())  # deterministic mean
        dv = a * BUDGET
        if dv < 0.05:
            return {"type": "coast"}
        return {"type": "burn", "dir": o["worstBurnDir"], "dv": dv}
    return {"name": "ppo", "decide": decide}


# ----------------------------- evaluation -----------------------------------
def evaluate(policy, scenarios):
    results = []
    for sc in scenarios:
        results.append(DriftEnv(scenario=sc).run_policy(policy))
    return aggregate(results)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ppo-updates", type=int, default=50)
    ap.add_argument("--eval-n", type=int, default=60)
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "data/train.jsonl"))
    args = ap.parse_args()

    print("\n[1/3] Behavior cloning from the oracle dataset")
    bc_net = train_bc(args.data)

    print(f"\n[2/3] PPO (oracle warm-start + fine-tune, val model-selection) on the env ({args.ppo_updates} updates)")
    val = generate_batch(30, 100_000)  # disjoint from train (1000s) and test (900000s)
    ac, curve = train_ppo(updates=args.ppo_updates, warm_start=args.data, val_scenarios=val)
    print(f"  PPO return: {curve[0]:.2f} (start) -> {np.mean(curve[-5:]):.2f} (last-5 avg)")

    print(f"\n[3/3] Evaluation on held-out test split (n={args.eval_n}, seeds 900000+)")
    test = generate_batch(args.eval_n, 900_000)
    table = {
        "oracle": evaluate(optimal_policy(), test),
        "bc": evaluate(bc_policy(bc_net), test),
        "ppo": evaluate(ppo_policy(ac), test),
        "random": evaluate(random_policy(), test),
    }
    cols = ["policy", "success", "regret", "unsafe", "mean Δv", "violations", "over-budget"]
    rows = [cols]
    for name, a in table.items():
        rows.append([name, f"{a['success_pct']}%", (f"{a['mean_regret']}x" if a["mean_regret"] is not None else "—"),
                     str(a["unsafe"]), f"{a['mean_dv']}", str(a["violations"]), str(a["over_budget"])])
    w = [max(len(r[c]) for r in rows) for c in range(len(cols))]
    print()
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nheadline = regret (Δv/par); learned policies trained only on train/disjoint seeds.\n")


if __name__ == "__main__":
    main()
