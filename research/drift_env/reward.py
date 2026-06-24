"""Reward functions for the DRIFT env. All take (sim, dv_step, done) -> float."""


def shaped_reward(dv_cost=1.0, resolved_bonus=10.0, fail_penalty=10.0, step_penalty=0.01):
    """Dense: pay for Δv spent each step; big terminal bonus/penalty on outcome.
    Encourages resolving with the *least* Δv (i.e. close to par)."""
    def fn(sim, dv_step, done):
        r = -dv_cost * dv_step - step_penalty
        if done:
            st = sim.phys.status
            if st == "RESOLVED":
                r += resolved_bonus
            elif st in ("COLLISION", "UNSAFE"):
                r -= fail_penalty
        return r
    return fn


def sparse_reward():
    """Terminal only: +par/Δv on success (1.0 = optimal), −1 on failure."""
    def fn(sim, dv_step, done):
        if not done:
            return 0.0
        if sim.phys.status == "RESOLVED":
            return (sim.phys.parDv / sim.phys.dvUsed) if sim.phys.dvUsed > 0 else 1.0
        return -1.0
    return fn


REWARDS = {"shaped": shaped_reward, "sparse": sparse_reward}
