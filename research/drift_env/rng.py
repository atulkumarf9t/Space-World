"""Seeded PRNG — a byte-exact port of src/rng.js (mulberry32) so Python and JS
produce identical scenarios. Pure stdlib."""

import math

_MASK = 0xFFFFFFFF


def _u32(x: int) -> int:
    return x & _MASK


def _imul(a: int, b: int) -> int:
    # JS Math.imul: 32-bit integer multiply (low 32 bits)
    return _u32((a & _MASK) * (b & _MASK))


def mulberry32(seed: int):
    a = _u32(seed)

    def nxt() -> float:
        nonlocal a
        a = _u32(a + 0x6D2B79F5)
        t = _imul(a ^ (a >> 15), 1 | a)
        t = _u32(_u32(t + _imul(t ^ (t >> 7), 61 | t)) ^ t)
        return _u32(t ^ (t >> 14)) / 4294967296.0

    return nxt


class Rng:
    """Mirrors the JS Rng class call-for-call (critical for scenario parity)."""

    def __init__(self, seed: int = 1):
        self.next = mulberry32(seed)

    def float(self, lo: float = 0.0, hi: float = 1.0) -> float:
        return lo + (hi - lo) * self.next()

    def int(self, lo: int, hi: int) -> int:
        return math.floor(self.float(lo, hi + 1))

    def pick(self, arr):
        return arr[math.floor(self.next() * len(arr))]

    def sign(self) -> int:
        return -1 if self.next() < 0.5 else 1

    def normal(self, mean: float = 0.0, sd: float = 1.0) -> float:
        u = max(1e-12, self.next())
        v = self.next()
        return mean + sd * math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)
