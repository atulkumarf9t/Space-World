# DRIFT 3D — Third-Person Conjunction Resolution

An autonomous ion-probe agent flies in a **third-person 3D world** (Three.js) under
Newtonian 6-DoF physics. It must resolve a **dual threat**: protect a non-maneuvering
**ally satellite** and avoid an incoming **asteroid**, using the **least delta-v**.
You can grab the stick to dodge manually and hand control back.

A live **Reactor** generative backdrop streams behind the 3D scene (synced to flight
controls). Without a Reactor token, a procedural starfield is used instead.

## Run

```bash
node server/proxy.js
# open http://localhost:5173
```

Optional keys in `.env` (copy from `.env.example`):

- `REACTOR_API_KEY` — server mints a short-lived JWT via `POST /api/reactor-token` ([Authentication](https://docs.reactor.inc/authentication)); never sent to the browser
- `GEMINI_API_KEY` — advisory narration via server-side proxy

Default Reactor model is **`lingbot`** (navigable WASD backdrop). Use `?model=helios` for prompt-only streaming ([Helios](https://docs.reactor.inc/model-api-reference/helios/overview) has no WASD navigation).

## Controls

| Key | Action |
|---|---|
| `G` / button | Grab / release manual control |
| `W` / `S` | Forward / back thrust |
| `A` / `D` | Strafe left / right |
| `Q` / `E` | Down / up thrust |
| `R` | Reset and run another encounter |

## Architecture

| Module | Role |
|---|---|
| `src/physics.js` | Authoritative 3D Newtonian sim: probe/ally/asteroid, TCA, miss, collisions, delta-v ledger |
| `src/scene3d.js` | Three.js third-person render + Reactor VideoTexture backdrop |
| `src/flight_model.js` | EP transfer function: 6-DoF thrust, power-from-light gating |
| `src/world_client.js` | Reactor SDK wrapper + flight-synced control messages |
| `src/agent.js` | Dual-threat cognition: min-delta-v plan, refusal, narration |
| `src/orchestrator.js` | Loops (8/10/1 Hz) + cruise → alert → resolve → score |
| `src/overlay.js` | HUD reticles, threat panel, delta-v gauge, grade card |
