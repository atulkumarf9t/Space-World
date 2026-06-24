// ep_model.js
// Physically-honest electric-propulsion (gridded ion) numbers for the EP console.
//
// The flight sim is tuned for game feel (thrustAccel 0.0008 km/s^2 = 0.8 m/s^2 at
// full power). A real solar-electric ion engine produces ~mm/s^2. Rather than hide
// that gap, we derive the true engine quantities from a coherent spec and expose the
// ratio as an explicit TIME-WARP factor — the game compresses minutes of ion burn
// into a moment. That IS the deep physics: thrust is tiny, Isp is enormous.
//
// Relations used:
//   exhaust velocity  ve   = Isp * g0
//   thrust            F    = 2 * eta * P / ve         (jet-power -> thrust)
//   mass flow         mdot = F / ve
//   real accel        a    = F / m
//   time-warp         k    = a_game / a_real

export const EP_SPEC = {
  g0: 9.80665, // m/s^2
  Isp: 3200, // s  (gridded xenon ion, NSTAR/NEXT class)
  eta: 0.62, // thruster efficiency
  powerMaxKw: 4.5, // kW solar array output at full sun
  massKg: 140, // spacecraft mass (treated constant for display)
  xenonKg: 6.0, // propellant tank capacity
};

const ve = EP_SPEC.Isp * EP_SPEC.g0; // m/s, ~31.4 km/s

// derive({ powerAuthority, thrusting, propellantPct, gameAccel })
//   powerAuthority: 0.15..1   fraction of solar power available (from light)
//   thrusting:      bool      thruster currently firing
//   propellantPct:  0..1      remaining propellant (shared ledger)
//   gameAccel:      m/s^2     the sim's current commanded accel at full power
export function epDerive({ powerAuthority = 1, thrusting = false, propellantPct = 1, gameAccel = 0.8 }) {
  const powerKw = EP_SPEC.powerMaxKw * powerAuthority;
  const powerW = powerKw * 1000;
  const thrustN = thrusting ? (2 * EP_SPEC.eta * powerW) / ve : 0;
  const thrustMn = thrustN * 1000; // mN
  const mdot = thrustN / ve; // kg/s
  const mdotMgs = mdot * 1e6; // mg/s
  const aReal = (2 * EP_SPEC.eta * powerW) / ve / EP_SPEC.massKg; // m/s^2 if firing at this power
  const aGame = gameAccel * powerAuthority; // m/s^2 felt in-game at this power
  const timeWarp = aReal > 0 ? aGame / aReal : 0;
  const xenonKg = EP_SPEC.xenonKg * Math.max(0, propellantPct);

  return {
    powerKw, // available solar power
    thrustMn, // current thrust (mN)
    isp: EP_SPEC.Isp, // s
    veKms: ve / 1000, // exhaust velocity km/s
    mdotMgs, // propellant mass flow mg/s
    aRealMms: aReal * 1000, // real accel in mm/s^2
    timeWarp, // a_game / a_real
    xenonKg, // xenon remaining
  };
}
