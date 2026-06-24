// policies.js — decision policies for the autonomous agent (Phase 2).
//
// A policy is `decide(obs) -> action`. It never touches the craft directly; it
// only proposes an action, which the Simulation's deterministic guard validates
// and meters. This is the safety contract: the LLM (or any policy) sets strategy;
// the guard guarantees nothing illegal or over-budget ever executes.
//
// Action shape: { type: 'burn', dir: {x,y,z}, dv: <m/s> } | { type: 'coast' }
//
// Observation shape (built by Simulation.observe):
//   {
//     worst: { target, pc, predictedMiss, tca, safe } | null,
//     worstBurnDir: {x,y,z}, worstRecommendedDv: number,
//     dSafe, pcThreshold, budgetRemaining, dvUsed, parDv, powerAuthority
//   }

const coast = () => ({ type: 'coast' });

// Optimal-ish: act exactly when Pc exceeds threshold, with the least-Δv burn.
export function optimalPolicy() {
  return {
    name: 'optimal',
    decide(obs) {
      // obs.worst is only populated when a threat is UNSAFE (Pc or ring breach).
      if (!obs.worst || obs.worstRecommendedDv <= 0) return coast();
      return { type: 'burn', dir: obs.worstBurnDir, dv: obs.worstRecommendedDv };
    },
  };
}

// Heuristic: no Pc awareness — react to geometric miss with fixed-size nudges.
export function heuristicPolicy(step = 1.2) {
  return {
    name: 'heuristic',
    decide(obs) {
      const w = obs.worst;
      if (!w || w.predictedMiss >= obs.dSafe) return coast();
      return { type: 'burn', dir: obs.worstBurnDir, dv: step };
    },
  };
}

// Random baseline: occasionally fires a small burn in the recommended direction.
export function randomPolicy(rng = Math.random) {
  return {
    name: 'random',
    decide(obs) {
      if (rng() < 0.25 && obs.worst) {
        return { type: 'burn', dir: obs.worstBurnDir, dv: 0.4 + rng() * 1.5 };
      }
      return coast();
    },
  };
}

// Does nothing — the control group (how bad is "ignore the conjunction"?).
export function nullPolicy() {
  return { name: 'null', decide: () => coast() };
}

// LLM policy via the app's Gemini proxy (browser only; needs GEMINI_API_KEY).
// Async: caches the last decision so it can be consulted from a sync loop.
/** @param {{ endpoint?: string, fetchImpl?: Function }} [opts] */
export function llmPolicy(opts = {}) {
  const { endpoint = '/api/agent', fetchImpl } = opts;
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  let last = coast();
  let inflight = false;
  return {
    name: 'llm',
    decide(obs) {
      if (f && !inflight) {
        inflight = true;
        f(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ observation: summarize(obs) }),
        })
          .then((r) => r.json())
          .then((j) => { if (j && j.action) last = sanitize(j.action, obs); })
          .catch(() => {})
          .finally(() => { inflight = false; });
      }
      return last; // guard re-validates regardless
    },
  };
}

function summarize(obs) {
  const w = obs.worst;
  return {
    worstTarget: w?.target ?? null,
    pc: w?.pc ?? 0,
    predictedMiss: w?.predictedMiss ?? null,
    tca: w?.tca ?? null,
    pcThreshold: obs.pcThreshold,
    budgetRemaining: obs.budgetRemaining,
    recommendedDv: obs.worstRecommendedDv,
  };
}

function sanitize(a, obs) {
  if (!a || a.type !== 'burn') return coast();
  const dir = a.dir && isFinite(a.dir.x) ? a.dir : obs.worstBurnDir;
  const dv = Math.max(0, Math.min(obs.budgetRemaining, +a.dv || 0));
  return dv > 0 ? { type: 'burn', dir, dv } : coast();
}
