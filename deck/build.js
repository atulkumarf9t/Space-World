// build.js — DRIFT 3D presentation deck
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fa = require("react-icons/fa");

// ---- palette (matches the app HUD) -------------------------------------
const C = {
  bg: "05080F", panel: "0B1120", panel2: "0E1626", line: "1C2840",
  ink: "DBE7FF", dim: "8A93A6",
  cyan: "5CC8FF", green: "3AD29F", orange: "FF9F43", red: "FF5D5D",
  amber: "FFCF5C", ast: "C48855",
};
const HEAD = "Consolas";
const BODY = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "DRIFT 3D";
pres.title = "DRIFT 3D — Autonomous Conjunction Resolution";
const W = 13.333, H = 7.5;

// ---- icon rasterization ------------------------------------------------
async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color, size: String(size) })
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const I = {};
async function loadIcons() {
  const set = {
    shield: [Fa.FaShieldAlt, C.green], meteor: [Fa.FaMeteor, C.ast],
    bolt: [Fa.FaBolt, C.cyan], sun: [Fa.FaSun, C.amber],
    hand: [Fa.FaHandPaper, C.orange], brain: [Fa.FaBrain, C.cyan],
    globe: [Fa.FaGlobe, C.green], dish: [Fa.FaSatelliteDish, C.cyan],
    sat: [Fa.FaSatellite, C.green], route: [Fa.FaRoute, C.cyan],
    robot: [Fa.FaRobot, C.cyan], warn: [Fa.FaExclamationTriangle, C.amber],
    crosshair: [Fa.FaCrosshairs, C.cyan], gauge: [Fa.FaTachometerAlt, C.cyan],
    moon: [Fa.FaMoon, C.dim],
  };
  for (const [k, [comp, col]] of Object.entries(set)) I[k] = await icon(comp, "#" + col);
}

// ---- helpers -----------------------------------------------------------
const shadow = () => ({ type: "outer", color: "000000", blur: 9, offset: 3, angle: 90, opacity: 0.35 });

function base(slide, dark = true) {
  slide.background = { color: dark ? C.bg : C.panel };
}
function tag(slide, text, x = 0.6, y = 0.5) {
  slide.addText(text, { x, y, w: 8, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 11, color: C.cyan, charSpacing: 3, bold: true });
}
function title(slide, text, x = 0.6, y = 0.82, w = 12.1, size = 32) {
  slide.addText(text, { x, y, w, h: 0.9, margin: 0, fontFace: HEAD, fontSize: size, color: C.ink, bold: true });
}
function footer(slide, n) {
  slide.addText("DRIFT 3D", { x: 0.6, y: 7.05, w: 4, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 9, color: C.dim, charSpacing: 2 });
  slide.addText(n, { x: 9.0, y: 7.05, w: 3.73, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 9, color: C.dim, align: "right", charSpacing: 2 });
}
function card(slide, x, y, w, h, fill = C.panel2) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: C.line, width: 1 }, shadow: shadow() });
}
function ring(slide, cx, cy, r, color, width = 1.5, transparency = 0) {
  slide.addShape(pres.shapes.OVAL, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill: { type: "none" }, line: { color, width, transparency } });
}
function dot(slide, cx, cy, r, color) {
  slide.addShape(pres.shapes.OVAL, { x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill: { color } });
}
function dline(slide, x1, y1, x2, y2, color, dash = "dash", width = 1.25) {
  slide.addShape(pres.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color, width, dashType: dash } });
}
// reticle motif in a corner
function reticle(slide, cx, cy) {
  ring(slide, cx, cy, 0.95, C.line, 1);
  ring(slide, cx, cy, 0.62, C.cyan, 1, 40);
  dot(slide, cx, cy, 0.05, C.cyan);
}

// ============================================================ SLIDE 1
function slideTitle() {
  const s = pres.addSlide(); base(s);
  // faint reticle field, right side
  ring(s, 10.4, 3.6, 2.5, C.line, 1);
  ring(s, 10.4, 3.6, 1.7, C.cyan, 1.25, 55);
  ring(s, 10.4, 3.6, 0.95, C.green, 1.25, 55);
  dline(s, 7.9, 3.6, 12.9, 3.6, C.line, "dash", 1);
  dline(s, 10.4, 1.1, 10.4, 6.1, C.line, "dash", 1);
  dot(s, 10.4, 3.6, 0.08, C.cyan);            // probe
  dot(s, 11.6, 2.45, 0.09, C.green);          // ally
  dot(s, 11.25, 4.7, 0.1, C.ast);             // asteroid
  s.addText("ALLY", { x: 11.75, y: 2.3, w: 1.2, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.green });
  s.addText("ASTEROID", { x: 11.4, y: 4.6, w: 1.6, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.ast });

  s.addText("// AUTONOMOUS SPACE OPERATIONS", { x: 0.7, y: 1.5, w: 8, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 13, color: C.cyan, charSpacing: 3, bold: true });
  s.addText("DRIFT 3D", { x: 0.62, y: 2.0, w: 8.5, h: 1.4, margin: 0, fontFace: HEAD, fontSize: 78, color: C.ink, bold: true, charSpacing: 2 });
  s.addText("Autonomous Conjunction Resolution on Electric Propulsion", { x: 0.7, y: 3.45, w: 8.2, h: 0.5, margin: 0, fontFace: BODY, fontSize: 19, color: C.cyan });
  s.addText("An agent that perceives, plans, and flies real physics —\ninside a world dreamed in real time.", { x: 0.7, y: 4.15, w: 7.6, h: 0.9, margin: 0, fontFace: BODY, fontSize: 15, color: C.dim, italic: true, lineSpacingMultiple: 1.1 });

  // chips
  const chips = [["PROTECT", C.green], ["AVOID", C.ast], ["LEAST Δv", C.cyan]];
  chips.forEach(([t, col], i) => {
    const x = 0.7 + i * 2.05;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 5.35, w: 1.9, h: 0.5, fill: { color: C.panel2 }, line: { color: col, width: 1 }, rectRadius: 0.08 });
    s.addText(t, { x, y: 5.35, w: 1.9, h: 0.5, margin: 0, fontFace: HEAD, fontSize: 12, color: col, align: "center", valign: "middle", bold: true });
  });
  footer(s, "INCEPTION · AGENTS IN WORLDS");
}

// ============================================================ SLIDE 2
function slideProblem() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 01  THE DILEMMA");
  title(s, "A converging encounter, two constraints");

  // left: three constraint rows
  const rows = [
    [I.shield, C.green, "Protect the ally", "A non-maneuvering satellite must stay outside the safe ring."],
    [I.meteor, C.ast, "Avoid the asteroid", "An incoming hazard on a collision course with the probe."],
    [I.bolt, C.cyan, "Spend the least Δv", "Every maneuver burns propellant — and propellant is mission life."],
  ];
  let y = 2.1;
  for (const [ic, col, h, d] of rows) {
    card(s, 0.6, y, 6.0, 1.35);
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y, w: 0.09, h: 1.35, fill: { color: col } });
    s.addImage({ data: ic, x: 0.95, y: y + 0.32, w: 0.7, h: 0.7 });
    s.addText(h, { x: 1.9, y: y + 0.22, w: 4.5, h: 0.4, margin: 0, fontFace: HEAD, fontSize: 17, color: C.ink, bold: true });
    s.addText(d, { x: 1.9, y: y + 0.66, w: 4.5, h: 0.6, margin: 0, fontFace: BODY, fontSize: 12.5, color: C.dim });
    y += 1.55;
  }

  // right: conjunction diagram
  card(s, 7.0, 2.1, 5.7, 4.35, C.panel);
  s.addText("CONJUNCTION GEOMETRY", { x: 7.2, y: 2.25, w: 5, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 10, color: C.dim, charSpacing: 2 });
  const px = 8.1, py = 5.4, ax = 11.6, ay = 3.2, mx = 11.3, my = 5.6;
  dline(s, px, py, ax, ay, C.green, "dash");
  dline(s, mx, my, px + 0.4, py - 0.2, C.red, "dash");
  ring(s, ax, ay, 0.62, C.green, 1.25, 30);     // ally safe ring
  ring(s, mx, my, 0.55, C.ast, 1.25, 30);       // asteroid ring
  dot(s, px, py, 0.11, C.cyan);
  dot(s, ax, ay, 0.1, C.green);
  dot(s, mx, my, 0.12, C.ast);
  s.addText("PROBE", { x: px - 0.55, y: py + 0.18, w: 1.3, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.cyan, align: "center" });
  s.addText("ALLY", { x: ax + 0.3, y: ay - 0.55, w: 1.2, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.green });
  s.addText("ASTEROID", { x: mx - 0.2, y: my + 0.55, w: 1.8, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.ast, align: "center" });
  s.addText("safe ring · miss distance · time-to-closest-approach", { x: 7.2, y: 6.0, w: 5.3, h: 0.3, margin: 0, fontFace: BODY, fontSize: 11, color: C.dim, italic: true });

  footer(s, "02");
}

// ============================================================ SLIDE 3
function slideArch() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 02  HOW IT WORKS");
  title(s, "Three loops, one craft");

  const cols = [
    [I.brain, C.cyan, "COGNITION", "~1 Hz · the brain", "Plans a minimum-Δv maneuver, narrates intent, refuses moves it can't afford."],
    [I.bolt, C.orange, "EP FLIGHT MODEL", "~8 Hz · the constraint", "Turns intent into metered thrust under momentum, propellant and power limits."],
    [I.globe, C.green, "WORLD MODEL", "24–30 fps · the medium", "A live Reactor backdrop, streamed over WebRTC and composited behind the scene."],
  ];
  const cw = 3.78, gap = 0.34, x0 = 0.6, y = 2.15, ch = 3.5;
  cols.forEach(([ic, col, h, sub, d], i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, y, cw, ch);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.09, fill: { color: col } });
    s.addImage({ data: ic, x: x + 0.4, y: y + 0.45, w: 0.85, h: 0.85 });
    s.addText(h, { x: x + 0.4, y: y + 1.45, w: cw - 0.8, h: 0.4, margin: 0, fontFace: HEAD, fontSize: 18, color: C.ink, bold: true });
    s.addText(sub, { x: x + 0.4, y: y + 1.9, w: cw - 0.8, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 11, color: col });
    s.addText(d, { x: x + 0.4, y: y + 2.3, w: cw - 0.8, h: 1.0, margin: 0, fontFace: BODY, fontSize: 13, color: C.dim, lineSpacingMultiple: 1.1 });
    if (i < 2) s.addText("→", { x: x + cw + gap / 2 - 0.18, y: y + 1.35, w: 0.4, h: 0.5, margin: 0, fontFace: HEAD, fontSize: 22, color: C.dim, align: "center" });
  });
  // thesis strip
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 6.05, w: 12.13, h: 0.7, fill: { color: C.panel2 }, line: { color: C.line, width: 1 } });
  s.addText([
    { text: "The signature idea:  ", options: { color: C.dim, fontFace: BODY } },
    { text: "electric propulsion is the transfer function between the agent's will and the controls.", options: { color: C.ink, fontFace: BODY, bold: true } },
  ], { x: 0.85, y: 6.05, w: 11.6, h: 0.7, margin: 0, fontSize: 13.5, valign: "middle" });
  footer(s, "03");
}

// ============================================================ SLIDE 4
function slideDemo() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 03  LIVE DEMO");
  title(s, "Watch the agent resolve a conjunction");

  // stylized viewport
  card(s, 0.6, 2.1, 8.2, 4.5, "02040A");
  // reticles + trajectories inside viewport
  const vx0 = 0.6, vy0 = 2.1, vw = 8.2, vh = 4.5;
  const px = vx0 + 2.2, py = vy0 + 3.0, ax = vx0 + 6.1, ay = vy0 + 1.4, mx = vx0 + 6.6, my = vy0 + 3.4;
  dline(s, px, py, ax, ay, C.green, "dash");
  dline(s, mx, my, px, py, C.red, "solid", 1.5);
  ring(s, ax, ay, 0.7, C.green, 1.5, 25);
  ring(s, mx, my, 0.6, C.ast, 1.5, 25);
  // crosshair reticle around ally
  dline(s, ax - 0.95, ay, ax - 0.7, ay, C.green, "solid", 1.5);
  dline(s, ax + 0.7, ay, ax + 0.95, ay, C.green, "solid", 1.5);
  dot(s, px, py, 0.12, C.cyan);
  dot(s, ax, ay, 0.1, C.green);
  dot(s, mx, my, 0.13, C.ast);
  s.addText("ALLY — PROTECT", { x: ax - 1.1, y: ay - 1.0, w: 2.2, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.green, align: "center" });
  s.addText("ASTEROID — AVOID", { x: mx - 0.6, y: my + 0.65, w: 2.4, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.ast, align: "center" });
  // HUD chips top-left of viewport
  s.addText("DUAL THREAT ALERT", { x: vx0 + 0.25, y: vy0 + 0.2, w: 3, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 11, color: C.red, bold: true });
  s.addText("AUTOPILOT — AGENT", { x: vx0 + vw - 3.0, y: vy0 + 0.2, w: 2.8, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 10, color: C.cyan, align: "right" });

  // right: what to watch
  s.addText("WHAT TO WATCH", { x: 9.1, y: 2.15, w: 3.6, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 11, color: C.cyan, charSpacing: 2, bold: true });
  const pts = [
    [I.route, "Trajectory ribbons trace each body's predicted path."],
    [I.crosshair, "TCA markers pin the moment of closest approach."],
    [I.warn, "The miss line flips red → green as it clears the safe ring."],
    [I.gauge, "The Δv ledger grades efficiency against the optimal burn."],
  ];
  let y = 2.7;
  for (const [ic, t] of pts) {
    s.addImage({ data: ic, x: 9.1, y: y + 0.04, w: 0.42, h: 0.42 });
    s.addText(t, { x: 9.7, y: y - 0.05, w: 3.0, h: 0.7, margin: 0, fontFace: BODY, fontSize: 13, color: C.ink, lineSpacingMultiple: 1.05 });
    y += 0.92;
  }
  footer(s, "04");
}

// ============================================================ SLIDE 5
function slideEP() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 04  ELECTRIC PROPULSION");
  title(s, "Tiny thrust, enormous patience");

  const stats = [
    ["178", "mN", "thrust", C.cyan],
    ["3,200", "s", "specific impulse", C.green],
    ["31", "km/s", "exhaust velocity", C.amber],
    ["×630", "", "time-warp to play", C.orange],
  ];
  const cw = 2.86, gap = 0.3, x0 = 0.6, y = 2.35, ch = 2.5;
  stats.forEach(([num, unit, label, col], i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, y, cw, ch);
    s.addText([
      { text: num, options: { fontSize: 44, color: col, bold: true, fontFace: HEAD } },
      { text: unit ? " " + unit : "", options: { fontSize: 18, color: col, fontFace: HEAD } },
    ], { x, y: y + 0.5, w: cw, h: 1.0, margin: 0, align: "center", valign: "middle" });
    s.addText(label, { x, y: y + 1.6, w: cw, h: 0.5, margin: 0, fontFace: BODY, fontSize: 13.5, color: C.dim, align: "center" });
  });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 5.35, w: 12.13, h: 1.4, fill: { color: C.panel2 }, line: { color: C.line, width: 1 } });
  s.addText([
    { text: "Real ion engines are agonizingly gentle — millinewtons of thrust.  ", options: { color: C.ink, bold: true } },
    { text: "The craft is heavy and committed: plan turns early, ration xenon, and ", options: { color: C.dim } },
    { text: "coast for free", options: { color: C.cyan, bold: true } },
    { text: ". The console shows honest numbers; the time-warp keeps it playable.", options: { color: C.dim } },
  ], { x: 0.95, y: 5.35, w: 11.4, h: 1.4, margin: 0, fontFace: BODY, fontSize: 15, valign: "middle", lineSpacingMultiple: 1.15 });
  footer(s, "05");
}

// ============================================================ SLIDE 6
function slidePower() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 05  POWER FROM LIGHT");
  title(s, "The world changes what the craft can do");

  // two state cards: full sun vs shadow
  const states = [
    ["IN SUNLIGHT", C.amber, I.sun, 0.95, "100% power authority", "Full thrust available — the agent can maneuver freely.", C.cyan],
    ["IN SHADOW", C.dim, I.moon, 0.28, "≈30% power authority", "Thrust fades — the agent eases off and coasts until it brightens.", C.red],
  ];
  const cw = 5.95, gap = 0.23, x0 = 0.6, y = 2.15, ch = 3.4;
  states.forEach(([h, hc, ic, frac, big, d, barc], i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, y, cw, ch);
    s.addImage({ data: ic, x: x + 0.4, y: y + 0.4, w: 0.8, h: 0.8 });
    s.addText(h, { x: x + 1.4, y: y + 0.45, w: cw - 1.6, h: 0.4, margin: 0, fontFace: HEAD, fontSize: 18, color: hc, bold: true });
    s.addText(big, { x: x + 1.4, y: y + 0.9, w: cw - 1.6, h: 0.35, margin: 0, fontFace: HEAD, fontSize: 13, color: C.ink });
    // thrust bar
    s.addText("THRUST AUTHORITY", { x: x + 0.4, y: y + 1.65, w: 4, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.dim, charSpacing: 1 });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.4, y: y + 1.95, w: cw - 0.8, h: 0.34, fill: { color: "0A0F1C" }, line: { color: C.line, width: 1 } });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.4, y: y + 1.95, w: (cw - 0.8) * frac, h: 0.34, fill: { color: barc } });
    s.addText(d, { x: x + 0.4, y: y + 2.5, w: cw - 0.8, h: 0.8, margin: 0, fontFace: BODY, fontSize: 13, color: C.dim, lineSpacingMultiple: 1.1 });
  });
  s.addText("Thrust power is read from the brightness of the generated scene — exactly like a solar-electric satellite losing power in eclipse.",
    { x: 0.6, y: 5.85, w: 12.13, h: 0.7, margin: 0, fontFace: BODY, fontSize: 14, color: C.ink, italic: true, align: "center" });
  footer(s, "06");
}

// ============================================================ SLIDE 7
function slideHuman() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 06  HUMAN ON THE LOOP");
  title(s, "Grab the stick, hand it back");

  // two role cards
  const roles = [
    [I.robot, C.cyan, "AGENT", "Autopilot", "Plans and flies the minimum-Δv solution by default."],
    [I.hand, C.orange, "YOU", "Manual (press G)", "Take over to dodge by hand, then release control back."],
  ];
  const cw = 3.5, x0 = 0.6, y = 2.15, ch = 2.4, gap = 0.3;
  roles.forEach(([ic, col, h, sub, d], i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, y, cw, ch);
    s.addImage({ data: ic, x: x + 0.4, y: y + 0.4, w: 0.75, h: 0.75 });
    s.addText(h, { x: x + 1.3, y: y + 0.42, w: cw - 1.5, h: 0.4, margin: 0, fontFace: HEAD, fontSize: 20, color: col, bold: true });
    s.addText(sub, { x: x + 1.3, y: y + 0.88, w: cw - 1.5, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 11, color: C.dim });
    s.addText(d, { x: x + 0.4, y: y + 1.4, w: cw - 0.8, h: 0.9, margin: 0, fontFace: BODY, fontSize: 13, color: C.ink, lineSpacingMultiple: 1.1 });
  });

  // Δv ledger panel
  const lx = 8.2, lw = 4.5;
  card(s, lx, y, lw, ch, C.panel);
  s.addText("Δv LEDGER", { x: lx + 0.35, y: y + 0.3, w: lw - 0.7, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 12, color: C.dim, charSpacing: 2 });
  const tx = lx + 0.35, tw = lw - 0.7, ty = y + 0.95;
  s.addShape(pres.shapes.RECTANGLE, { x: tx, y: ty, w: tw, h: 0.4, fill: { color: "0A0F1C" }, line: { color: C.line, width: 1 } });
  s.addShape(pres.shapes.RECTANGLE, { x: tx, y: ty, w: tw * 0.5, h: 0.4, fill: { color: C.cyan } });
  s.addShape(pres.shapes.RECTANGLE, { x: tx + tw * 0.5, y: ty, w: tw * 0.12, h: 0.4, fill: { color: C.orange } });
  // par marker
  s.addShape(pres.shapes.LINE, { x: tx + tw * 0.83, y: ty - 0.1, w: 0, h: 0.6, line: { color: C.dim, width: 1.5, dashType: "dash" } });
  s.addText("par", { x: tx + tw * 0.83 - 0.3, y: ty + 0.45, w: 0.8, h: 0.25, margin: 0, fontFace: HEAD, fontSize: 9, color: C.dim, align: "center" });
  s.addText([
    { text: "■ agent", options: { color: C.cyan, fontFace: HEAD, fontSize: 11 } },
    { text: "    ■ you", options: { color: C.orange, fontFace: HEAD, fontSize: 11 } },
  ], { x: tx, y: ty + 0.75, w: tw, h: 0.3, margin: 0 });
  s.addText("Every encounter is graded A–F on Δv efficiency vs. the optimal burn.", { x: lx + 0.35, y: y + 1.7, w: lw - 0.7, h: 0.6, margin: 0, fontFace: BODY, fontSize: 12, color: C.dim, italic: true });

  s.addText("Autonomy isn't all-or-nothing — the human-on-the-loop model real operations are moving toward.",
    { x: 0.6, y: 5.85, w: 12.13, h: 0.6, margin: 0, fontFace: BODY, fontSize: 14, color: C.ink, italic: true, align: "center" });
  footer(s, "07");
}

// ============================================================ SLIDE 8
function slideReal() {
  const s = pres.addSlide(); base(s);
  tag(s, "// 07  WHY IT MATTERS");
  title(s, "This is happening now");

  const stats = [
    ["30,000+", "tracked objects in orbit", C.cyan],
    ["30+", "ISS debris-avoidance maneuvers", C.green],
    ["tens of thousands", "Starlink maneuvers / 6 months", C.orange],
  ];
  const cw = 3.85, gap = 0.29, x0 = 0.6, y = 2.15, ch = 1.85;
  stats.forEach(([num, label, col], i) => {
    const x = x0 + i * (cw + gap);
    card(s, x, y, cw, ch);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.09, fill: { color: col } });
    s.addText(num, { x: x + 0.2, y: y + 0.4, w: cw - 0.4, h: 0.7, margin: 0, fontFace: HEAD, fontSize: num.length > 8 ? 24 : 38, color: col, bold: true, align: "center", valign: "middle" });
    s.addText(label, { x: x + 0.2, y: y + 1.2, w: cw - 0.4, h: 0.5, margin: 0, fontFace: BODY, fontSize: 12.5, color: C.dim, align: "center" });
  });

  const rows = [
    [I.crosshair, "Conjunction screening", "The US Space Force issues Conjunction Data Messages keyed on TCA & miss distance — the same quantities in the game."],
    [I.robot, "Automated avoidance", "ESA and others are building AI-assisted collision-avoidance as object counts climb toward Kessler-syndrome risk."],
    [I.bolt, "Solar electric propulsion", "Ion & Hall thrusters fly today on Dawn, Starlink and GEO comsats — solar-powered, so they lose thrust in eclipse."],
  ];
  let yy = 4.25;
  for (const [ic, h, d] of rows) {
    s.addImage({ data: ic, x: 0.7, y: yy + 0.05, w: 0.5, h: 0.5 });
    s.addText([
      { text: h + "   ", options: { color: C.ink, bold: true, fontFace: HEAD, fontSize: 14 } },
      { text: d, options: { color: C.dim, fontFace: BODY, fontSize: 13 } },
    ], { x: 1.4, y: yy - 0.05, w: 11.3, h: 0.7, margin: 0, valign: "middle", lineSpacingMultiple: 1.05 });
    yy += 0.83;
  }
  footer(s, "08");
}

// ============================================================ SLIDE 9
function slideClose() {
  const s = pres.addSlide(); base(s);
  reticle(s, 11.6, 1.5);
  ring(s, 1.7, 6.0, 1.1, C.line, 1);
  ring(s, 1.7, 6.0, 0.7, C.green, 1, 50);

  s.addText("// CLOSE", { x: 0.7, y: 1.8, w: 6, h: 0.3, margin: 0, fontFace: HEAD, fontSize: 12, color: C.cyan, charSpacing: 3, bold: true });
  s.addText("Deterministic physics you can trust.\nA generative world you can't predict.\nAn autonomous pilot reasoning between them.",
    { x: 0.7, y: 2.35, w: 11.8, h: 2.2, margin: 0, fontFace: HEAD, fontSize: 30, color: C.ink, bold: true, lineSpacingMultiple: 1.15 });
  s.addText("DRIFT 3D", { x: 0.7, y: 5.2, w: 6, h: 0.6, margin: 0, fontFace: HEAD, fontSize: 24, color: C.cyan, bold: true, charSpacing: 2 });
  s.addText("Thank you — questions welcome.", { x: 0.7, y: 5.85, w: 8, h: 0.4, margin: 0, fontFace: BODY, fontSize: 15, color: C.dim, italic: true });
  footer(s, "09");
}

async function main() {
  await loadIcons();
  slideTitle();
  slideProblem();
  slideArch();
  slideDemo();
  slideEP();
  slidePower();
  slideHuman();
  slideReal();
  slideClose();
  await pres.writeFile({ fileName: "../DRIFT_3D_Presentation.pptx" });
  console.log("written DRIFT_3D_Presentation.pptx");
}
main().catch((e) => { console.error(e); process.exit(1); });
