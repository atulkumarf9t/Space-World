"""E1 pixel-policy scaffold — train a frame-conditioned controller and compare it to a
numeric-state controller on the SAME target (behavior cloning of the agent's Δv).

This is the open-loop core of the E1 pixel study: does perceiving generated *pixels* match
perceiving clean numeric state? Closed-loop pixel control additionally needs a frame renderer
for novel states (the generative world model) — out of scope here.

Usage:
  python research/train_pixel.py --synth 600        # smoke test on a synthetic labeled corpus
  python research/train_pixel.py --corpus rec.jsonl # real corpus from src/reactor_record.js (?record=1)
"""

import argparse
import base64
import io
import json
import os
import random
import sys

import numpy as np
import torch
import torch.nn as nn
from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

H, W = 27, 48
torch.manual_seed(0)
np.random.seed(0)


def decode_frame(dataurl):
    b64 = dataurl.split(",", 1)[1] if "," in dataurl else dataurl
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("L").resize((W, H))
    return np.asarray(img, dtype=np.float32) / 255.0


def encode_frame(arr):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype("uint8"), "L")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def synth_corpus(n, path, seed=0):
    """Labeled synthetic corpus: a bright 'threat blob' whose size encodes Δv (a learnable
    visual cue), with the same signal mirrored in nobs[0] so the numeric baseline is fair."""
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        threatened = rng.random() < 0.4
        dv = (1.5 + rng.random() * 3.0) if threatened else 0.0
        # learnable visual cue: a left-anchored "gauge bar" whose width encodes Δv on a dark field
        arr = np.full((H, W), 0.12, dtype=np.float32) + np.random.normal(0, 0.01, (H, W)).astype(np.float32)
        w_bar = int(round(W * min(1.0, dv / 5.0)))
        if w_bar > 0:
            arr[:, :w_bar] = 0.92
        rows.append({"t": i * 0.1, "dv": round(dv, 3),
                     "nobs": [round(min(1.0, dv / 5.0), 4), 0.5, 0.5, 0.5, 1.0],
                     "frame": encode_frame(np.clip(arr, 0, 1))})
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(json.dumps(r) for r in rows))
    return len(rows)


class PixCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Flatten(),
            nn.Linear(16 * (H // 4) * (W // 4), 32), nn.ReLU(),
            nn.Linear(32, 1), nn.Softplus(),
        )

    def forward(self, x):
        return self.net(x)


def mlp(d):
    return nn.Sequential(nn.Linear(d, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 1), nn.Softplus())


def train(model, X, y, epochs=200, lr=2e-3):
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    lossf = nn.MSELoss()
    for _ in range(epochs):
        opt.zero_grad()
        loss = lossf(model(X), y)
        loss.backward()
        opt.step()
    return model


def evaluate(model, X, y):
    with torch.no_grad():
        pred = model(X)
        mse = float(((pred - y) ** 2).mean())
        burn_acc = float(((pred > 0.5) == (y > 0.5)).float().mean())
    return mse, burn_acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--synth", type=int, default=0, help="generate a synthetic labeled corpus of N frames")
    ap.add_argument("--corpus", default=None, help="recorded corpus jsonl (from ?record=1)")
    args = ap.parse_args()

    path = args.corpus
    if args.synth:
        path = os.path.join(os.path.dirname(__file__), "data", "synth_pixel_corpus.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f"[synth] writing {synth_corpus(args.synth, path)} labeled frames -> {path}")
    if not path:
        print("provide --synth N or --corpus <file>")
        return

    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    rows = [r for r in rows if "frame" in r and "dv" in r]
    if not rows:
        print("corpus has no labeled frames (needs 'frame' + 'dv'); re-record with the updated recorder.")
        return
    print(f"[data] {len(rows)} labeled frames")

    Xpix = torch.tensor(np.stack([decode_frame(r["frame"]) for r in rows])[:, None, :, :], dtype=torch.float32)
    y = torch.tensor([[float(r["dv"])] for r in rows], dtype=torch.float32)
    has_num = all(r.get("nobs") for r in rows)
    Xnum = torch.tensor([r["nobs"] for r in rows], dtype=torch.float32) if has_num else None

    n = len(rows)
    idx = np.random.permutation(n)
    cut = int(0.8 * n)
    tr, va = idx[:cut], idx[cut:]

    print("\n[1] pixel CNN  (frame -> Δv)")
    cnn = train(PixCNN(), Xpix[tr], y[tr])
    cmse, cacc = evaluate(cnn, Xpix[va], y[va])

    rows_out = [["model", "input", "val MSE", "burn-detect acc"]]
    rows_out.append(["pixel-cnn", f"{H}x{W} frame", f"{cmse:.4f}", f"{100*cacc:.0f}%"])
    if Xnum is not None:
        print("[2] numeric MLP  (nobs -> Δv)")
        m = train(mlp(Xnum.shape[1]), Xnum[tr], y[tr])
        nmse, nacc = evaluate(m, Xnum[va], y[va])
        rows_out.append(["numeric-mlp", f"{Xnum.shape[1]}-d obs", f"{nmse:.4f}", f"{100*nacc:.0f}%"])

    print("\nE1 pixel-vs-numeric (behavior cloning the agent's Δv)\n")
    w = [max(len(r[c]) for r in rows_out) for c in range(len(rows_out[0]))]
    for r in rows_out:
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
    print("\nA pixel-conditioned policy learns control from generated frames; the numeric baseline")
    print("is the clean-perception upper bound. On a REAL corpus this quantifies the perception gap.\n")


if __name__ == "__main__":
    main()
