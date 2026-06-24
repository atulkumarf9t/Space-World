# E1 — Reactor frame capture-replay (pixel-level extension)

The offline E1 study (`e1_coupling.py`) models the generative-world coupling through its one
real channel — **scene brightness → solar power → thrust authority** — plus a perception-noise
proxy. To run the *pixel-level* study (agents perceiving real generated frames), the live Reactor
stream must be made **reproducible**, because it is non-deterministic and rate-limited. This is the
capture-replay design.

## 1. Capture (browser, one-time)
Add a recorder to the running app (`src/reactor_record.js`, behind `?record=1`):
- On each `trackReceived` frame, draw the Reactor video to a canvas and store:
  - `frame` (JPEG, downscaled e.g. 160×90), `t` (ms), and the **derived `luminance`** (already
    computed by `pixel_sense.js`), plus the current `controlForReactor()` command sent that tick.
- Drive a scripted control sequence (the agent's WASD/look) so the captured world is paired with
  known actions.
- Save a `corpus/{session_id}.jsonl` (+ frames in a sidecar) — one row per frame:
  `{t, action, luminance, frame_ref}`.

## 2. Replay (offline, deterministic)
- A `FrameCorpus` loader yields `(t, frame, luminance, action)` deterministically.
- The headless env consumes the corpus instead of live Reactor:
  - `power_authority` is driven by the **recorded luminance** (the true coupling, no proxy).
  - A vision policy receives the actual `frame` pixels; a numeric policy receives the luminance.
- Because the corpus is fixed, training/eval are reproducible and seed-pinned.

## 3. Study (what the pixels add over the offline proxy)
- Replace `e1_coupling.py`'s synthetic `eclipse_power`/`corrupt` with corpus-driven luminance and
  real frames. Compare:
  - numeric-state agent vs **pixel-conditioned** agent (CNN/diffusion) on identical corpora,
  - clean vs generative perception (does world-model unpredictability degrade planning?).
- Headline metrics stay the same: regret vs par, success, unsafe — now under *real* generated
  perception.

## Why this is the right shape
- Keeps the verifiable physics + oracle (regret is still well-defined).
- Makes the generative, non-deterministic world **reproducible** (the blocker for research).
- Cleanly separates the two questions: *coupling* (luminance→power, already measured offline) and
  *perception* (pixels→action, the new pixel study).

## Status — pipeline implemented end-to-end
- **Capture** ✅ `src/reactor_record.js` (activate with `?record=1`): records `{t, luminance,
  power, mode, action, frame(jpeg)}` per sampled frame with a floating REC panel + Download.
  Verified in-browser under REACTOR LIVE (108 frames, real JPEGs + live luminance, no errors).
- **Replay** ✅ `research/drift_env/corpus.py` (`FrameCorpus`): loads the recorded JSONL and
  drives the env's power from replayed luminance.
- **Study** ✅ `research/e1_coupling.py --corpus <file>`: runs the coupling study on a recorded
  corpus (verified on a synthetic corpus; drop in a real recording to run on actual Reactor frames).
- **Remaining**: a one-off live recording session (Reactor key + run `?record=1`, click Download)
  to produce a real corpus, and a pixel-conditioned (CNN/diffusion) policy to compare vs the
  numeric agent.
