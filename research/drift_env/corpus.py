"""FrameCorpus — load a recorded Reactor corpus (from src/reactor_record.js, ?record=1)
and replay its luminance as the env's power schedule. Closes the E1 capture->replay loop:
the generative world's real brightness drives thrust authority offline & reproducibly."""

import bisect
import json


class FrameCorpus:
    def __init__(self, path):
        self.rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
        self.rows.sort(key=lambda r: r["t"])
        self.times = [r["t"] for r in self.rows]
        lums = [r.get("luminance", 255) for r in self.rows] or [255]
        self.ref = max(lums) or 1.0

    def __len__(self):
        return len(self.rows)

    def luminance_at(self, t):
        if not self.rows:
            return self.ref
        i = bisect.bisect_left(self.times, t)
        i = min(max(i, 0), len(self.rows) - 1)
        return self.rows[i].get("luminance", self.ref)

    def power_at(self, t):
        return min(1.0, max(0.15, self.luminance_at(t) / (self.ref * 0.95 or 1.0)))

    def power_schedule(self):
        return lambda t: self.power_at(t)

    def actions(self):
        return [r.get("action") for r in self.rows]
