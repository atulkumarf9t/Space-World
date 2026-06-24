// build_pdf.js — DRIFT 3D deck rendered straight to PDF (no Office needed)
const fs = require("fs");
const PDFDocument = require("pdfkit");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fa = require("react-icons/fa");

const C = {
  bg: "#05080F", panel: "#0B1120", panel2: "#0E1626", line: "#1C2840",
  ink: "#DBE7FF", dim: "#8A93A6",
  cyan: "#5CC8FF", green: "#3AD29F", orange: "#FF9F43", red: "#FF5D5D",
  amber: "#FFCF5C", ast: "#C48855", viewport: "#02040A",
};
const IN = 72;                 // points per inch
const PW = 13.333 * IN, PH = 7.5 * IN;

async function iconBuf(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color, size: String(size) }));
  return await sharp(Buffer.from(svg)).png().toBuffer();
}
const I = {};
async function loadIcons() {
  const set = {
    shield: [Fa.FaShieldAlt, C.green], meteor: [Fa.FaMeteor, C.ast],
    bolt: [Fa.FaBolt, C.cyan], sun: [Fa.FaSun, C.amber],
    hand: [Fa.FaHandPaper, C.orange], brain: [Fa.FaBrain, C.cyan],
    globe: [Fa.FaGlobe, C.green], robot: [Fa.FaRobot, C.cyan],
    warn: [Fa.FaExclamationTriangle, C.amber], route: [Fa.FaRoute, C.cyan],
    crosshair: [Fa.FaCrosshairs, C.cyan], gauge: [Fa.FaTachometerAlt, C.cyan],
    moon: [Fa.FaMoon, C.dim],
  };
  for (const [k, [comp, col]] of Object.entries(set)) I[k] = await iconBuf(comp, col);
}

const doc = new PDFDocument({ size: [PW, PH], margin: 0, autoFirstPage: false });
const F = { mono: "mono", monob: "monob", body: "body", bodyb: "bodyb", bodyi: "bodyi" };
try {
  doc.registerFont(F.mono, "C:\\Windows\\Fonts\\consola.ttf");
  doc.registerFont(F.monob, "C:\\Windows\\Fonts\\consolab.ttf");
  doc.registerFont(F.body, "C:\\Windows\\Fonts\\calibri.ttf");
  doc.registerFont(F.bodyb, "C:\\Windows\\Fonts\\calibrib.ttf");
  doc.registerFont(F.bodyi, "C:\\Windows\\Fonts\\calibrii.ttf");
} catch (e) { console.warn("font fallback:", e.message); }

// ---- primitives (inches in, points out) --------------------------------
const X = (v) => v * IN;
function page() { doc.addPage({ size: [PW, PH], margin: 0 }); }
function bg(color) { doc.save().rect(0, 0, PW, PH).fill(color).restore(); }
function rect(x, y, w, h, fill, stroke, lw = 1) {
  doc.save();
  if (fill) doc.rect(X(x), X(y), X(w), X(h)).fill(fill);
  if (stroke) doc.lineWidth(lw).rect(X(x), X(y), X(w), X(h)).stroke(stroke);
  doc.restore();
}
function ring(cx, cy, r, color, lw = 1.5, opacity = 1) {
  doc.save().lineWidth(lw).strokeOpacity(opacity).circle(X(cx), X(cy), X(r)).stroke(color).restore();
}
function dot(cx, cy, r, color) { doc.save().circle(X(cx), X(cy), X(r)).fill(color).restore(); }
function line(x1, y1, x2, y2, color, dash = true, lw = 1.25, opacity = 1) {
  doc.save().lineWidth(lw).strokeOpacity(opacity);
  if (dash) doc.dash(4, { space: 3 });
  doc.moveTo(X(x1), X(y1)).lineTo(X(x2), X(y2)).stroke(color);
  doc.restore();
}
// text: opts {size, color, font, align, w, cs(charSpacing), lineGap, valignH}
function text(str, x, y, opts = {}) {
  const { size = 14, color = C.ink, font = F.body, align = "left", w, cs = 0, lineGap = 0 } = opts;
  doc.save().font(font).fontSize(size).fillColor(color);
  const o = { align, lineGap, lineBreak: w != null };
  if (cs) o.characterSpacing = cs;
  if (w != null) o.width = X(w);
  doc.text(str, X(x), X(y), o);
  doc.restore();
}
// vertically center a single line inside a box
function vtext(str, x, y, w, h, opts = {}) {
  const size = opts.size || 14;
  const ty = y + (h - (size / IN) * 1.18) / 2;
  text(str, x, ty, { ...opts, w });
}
// rich single line: parts [{text,color,font}] same size
function rich(parts, x, y, w, opts = {}) {
  const { size = 14, align = "left", lineGap = 0 } = opts;
  doc.save().fontSize(size);
  parts.forEach((p, i) => {
    doc.font(p.font || F.body).fillColor(p.color || C.ink);
    const o = { width: X(w), align, lineGap, continued: i < parts.length - 1 };
    if (i === 0) doc.text(p.text, X(x), X(y), o);
    else doc.text(p.text, o);
  });
  doc.restore();
}
function img(buf, x, y, w, h) { doc.image(buf, X(x), X(y), { width: X(w), height: X(h) }); }

function tag(t) { text(t, 0.6, 0.5, { font: F.monob, size: 11, color: C.cyan, cs: 1.5 }); }
function title(t, size = 27) { text(t, 0.6, 0.82, { font: F.monob, size, color: C.ink, w: 12.1 }); }
function footer(n) {
  text("DRIFT 3D", 0.6, 7.05, { font: F.mono, size: 9, color: C.dim, cs: 1 });
  text(n, 8.0, 7.05, { font: F.mono, size: 9, color: C.dim, align: "right", w: 4.73 });
}
function note(str) {
  text(str, 0.6, 6.35, { font: F.bodyi, size: 10.5, color: C.dim, w: 12.13, lineGap: 1 });
}
function card(x, y, w, h, fill = C.panel2) { rect(x, y, w, h, fill, C.line, 1); }

// ============================================================ 1 TITLE
function s1() {
  page(); bg(C.bg);
  ring(10.4, 3.6, 2.5, C.line, 1);
  ring(10.4, 3.6, 1.7, C.cyan, 1.25, 0.45);
  ring(10.4, 3.6, 0.95, C.green, 1.25, 0.45);
  line(7.9, 3.6, 12.9, 3.6, C.line, true, 1);
  line(10.4, 1.1, 10.4, 6.1, C.line, true, 1);
  dot(10.4, 3.6, 0.08, C.cyan);
  dot(11.6, 2.45, 0.09, C.green);
  dot(11.25, 4.7, 0.1, C.ast);
  text("ALLY", 11.75, 2.22, { font: F.mono, size: 9, color: C.green });
  text("ASTEROID", 11.4, 4.85, { font: F.mono, size: 9, color: C.ast });

  text("// AUTONOMOUS SPACE OPERATIONS", 0.7, 1.5, { font: F.monob, size: 13, color: C.cyan, cs: 1.5 });
  text("DRIFT 3D", 0.66, 1.95, { font: F.monob, size: 78, color: C.ink, cs: 1 });
  text("Autonomous Conjunction Resolution on Electric Propulsion", 0.7, 3.5, { font: F.body, size: 19, color: C.cyan, w: 8.4 });
  text("An agent that perceives, plans, and flies real physics —\ninside a world dreamed in real time.", 0.7, 4.15, { font: F.bodyi, size: 15, color: C.dim, w: 7.8, lineGap: 3 });

  const chips = [["PROTECT", C.green], ["AVOID", C.ast], ["LEAST Δv", C.cyan]];
  chips.forEach(([t, col], i) => {
    const x = 0.7 + i * 2.05;
    rect(x, 5.35, 1.9, 0.5, C.panel2, col, 1);
    vtext(t, x, 5.35, 1.9, 0.5, { font: F.monob, size: 12, color: col, align: "center" });
  });
  note("Speaker: Space is getting crowded. Over 30,000 tracked objects, and satellites now dodge each other tens of thousands of times a year. DRIFT 3D is an interactive simulation of an autonomous probe doing exactly that — protecting an ally, avoiding a hazard, on real propulsion limits.");
  footer("01 · ~0:25");
}

// ============================================================ 2 PROBLEM
function s2() {
  page(); bg(C.bg); tag("// 01  THE DILEMMA"); title("A converging encounter, two constraints");
  const rows = [
    [I.shield, C.green, "Protect the ally", "A non-maneuvering satellite must stay outside the safe ring."],
    [I.meteor, C.ast, "Avoid the asteroid", "An incoming hazard on a collision course with the probe."],
    [I.bolt, C.cyan, "Spend the least Δv", "Every maneuver burns propellant — and propellant is mission life."],
  ];
  let y = 2.1;
  for (const [ic, col, h, d] of rows) {
    card(0.6, y, 6.0, 1.35); rect(0.6, y, 0.09, 1.35, col);
    img(ic, 0.95, y + 0.32, 0.7, 0.7);
    text(h, 1.9, y + 0.24, { font: F.monob, size: 16, color: C.ink, w: 4.5 });
    text(d, 1.9, y + 0.68, { font: F.body, size: 12, color: C.dim, w: 4.5, lineGap: 1 });
    y += 1.55;
  }
  card(7.0, 2.1, 5.7, 4.35, C.panel);
  text("CONJUNCTION GEOMETRY", 7.2, 2.27, { font: F.mono, size: 10, color: C.dim, cs: 1 });
  const px = 8.1, py = 5.4, ax = 11.6, ay = 3.2, mx = 11.3, my = 5.6;
  line(px, py, ax, ay, C.green);
  line(mx, my, px + 0.4, py - 0.2, C.red);
  ring(ax, ay, 0.62, C.green, 1.25, 0.7);
  ring(mx, my, 0.55, C.ast, 1.25, 0.7);
  dot(px, py, 0.11, C.cyan); dot(ax, ay, 0.1, C.green); dot(mx, my, 0.12, C.ast);
  text("PROBE", px - 0.55, py + 0.2, { font: F.mono, size: 9, color: C.cyan, align: "center", w: 1.3 });
  text("ALLY", ax + 0.3, ay - 0.5, { font: F.mono, size: 9, color: C.green });
  text("ASTEROID", mx - 0.2, my + 0.6, { font: F.mono, size: 9, color: C.ast, align: "center", w: 1.8 });
  text("safe ring · miss distance · time-to-closest-approach", 7.2, 5.85, { font: F.bodyi, size: 11, color: C.dim });
  note("Speaker: This is the real operational dilemma: you get a close-approach warning, and moving costs fuel you can never get back. The skill isn't dodging — it's dodging cheaply, without endangering something else.");
  footer("02 · ~0:40");
}

// ============================================================ 3 DEMO
function s3() {
  page(); bg(C.bg); tag("// 02  LIVE DEMO  ★ CENTERPIECE"); title("Watch the agent resolve a conjunction");
  const vx0 = 0.6, vy0 = 2.1, vw = 8.2, vh = 4.5;
  card(vx0, vy0, vw, vh, C.viewport);
  const px = vx0 + 2.2, py = vy0 + 3.0, ax = vx0 + 6.1, ay = vy0 + 1.4, mx = vx0 + 6.6, my = vy0 + 3.4;
  line(px, py, ax, ay, C.green);
  line(mx, my, px, py, C.red, false, 1.5);
  ring(ax, ay, 0.7, C.green, 1.5, 0.8);
  ring(mx, my, 0.6, C.ast, 1.5, 0.8);
  line(ax - 0.95, ay, ax - 0.7, ay, C.green, false, 1.5);
  line(ax + 0.7, ay, ax + 0.95, ay, C.green, false, 1.5);
  dot(px, py, 0.12, C.cyan); dot(ax, ay, 0.1, C.green); dot(mx, my, 0.13, C.ast);
  text("ALLY — PROTECT", ax - 1.1, ay - 0.95, { font: F.mono, size: 9, color: C.green, align: "center", w: 2.2 });
  text("ASTEROID — AVOID", mx - 0.6, my + 0.68, { font: F.mono, size: 9, color: C.ast, align: "center", w: 2.4 });
  text("DUAL THREAT ALERT", vx0 + 0.25, vy0 + 0.22, { font: F.monob, size: 11, color: C.red });
  text("AUTOPILOT — AGENT", vx0 + vw - 3.05, vy0 + 0.22, { font: F.mono, size: 10, color: C.cyan, align: "right", w: 2.8 });

  text("WHAT TO WATCH", 9.1, 2.18, { font: F.monob, size: 11, color: C.cyan, cs: 1 });
  const pts = [
    [I.route, "Trajectory ribbons trace each body's predicted path."],
    [I.crosshair, "TCA markers pin the moment of closest approach."],
    [I.warn, "The miss line flips red → green as it clears the safe ring."],
    [I.gauge, "The Δv ledger grades efficiency against the optimal burn."],
  ];
  let y = 2.72;
  for (const [ic, t] of pts) {
    img(ic, 9.1, y + 0.02, 0.42, 0.42);
    text(t, 9.7, y - 0.02, { font: F.body, size: 13, color: C.ink, w: 3.0, lineGap: 1 });
    y += 0.88;
  }
  note("Speaker: The agent sees the conjunction, plans a minimum-Δv burn, and narrates why. Watch the trajectory ribbons and the closest-approach markers — that's the geometry a flight dynamics engineer actually reasons about. Notice the miss line turn from red to green as it clears the safe ring.");
  footer("03 · ~0:55");
}

// ============================================================ 4 EP
function s4() {
  page(); bg(C.bg); tag("// 03  ELECTRIC PROPULSION"); title("Electric propulsion is the law");
  text("Tiny thrust, huge efficiency — heavy & committed: plan early, coast for free.", 0.6, 1.55, { font: F.body, size: 15, color: C.dim, w: 12.1 });
  const stats = [["178", "mN", "thrust", C.cyan], ["3,200", "s", "specific impulse", C.green], ["31.4", "km/s", "exhaust velocity", C.amber], ["×630", "", "time-warp to play", C.orange]];
  const cw = 2.86, gap = 0.3, x0 = 0.6, y = 2.35, ch = 2.5;
  stats.forEach(([num, unit, label, col], i) => {
    const x = x0 + i * (cw + gap);
    card(x, y, cw, ch);
    rich([
      { text: num, color: col, font: F.monob },
      { text: unit ? " " + unit : "", color: col, font: F.mono },
    ], x, y + 0.78, cw, { size: 40, align: "center" });
    text(label, x, y + 1.62, { font: F.body, size: 13.5, color: C.dim, align: "center", w: cw });
  });
  rect(0.6, 5.35, 12.13, 1.4, C.panel2, C.line, 1);
  rich([
    { text: "Real ion engines are agonizingly gentle — millinewtons of thrust.  ", color: C.ink, font: F.bodyb },
    { text: "The craft is heavy and committed: plan turns early, ration xenon, and ", color: C.dim, font: F.body },
    { text: "coast for free", color: C.cyan, font: F.bodyb },
    { text: ". Real ion burns take minutes; the time-warp compresses reality so it's playable.", color: C.dim, font: F.body },
  ], 0.95, 5.55, 11.4, { size: 14, lineGap: 3 });
  note("Speaker: Real ion engines are agonizingly gentle — millinewtons. The console shows honest numbers; the 'time-warp' is us compressing reality so it's playable. The lesson stays true: you cannot stop or turn on a dime.");
  footer("04 · ~0:45");
}

// ============================================================ 5 POWER
function s5() {
  page(); bg(C.bg); tag("// 04  POWER FROM LIGHT"); title("The world changes what the craft can do");
  const states = [
    ["IN SUNLIGHT", C.amber, I.sun, 0.95, "100% power authority", "Full thrust available — the agent can maneuver freely.", C.cyan],
    ["IN SHADOW", C.dim, I.moon, 0.28, "≈30% power authority", "Thrust fades — the agent eases off and coasts until it brightens.", C.red],
  ];
  const cw = 5.95, gap = 0.23, x0 = 0.6, y = 2.15, ch = 3.4;
  states.forEach(([h, hc, ic, frac, big, d, barc], i) => {
    const x = x0 + i * (cw + gap);
    card(x, y, cw, ch);
    img(ic, x + 0.4, y + 0.4, 0.8, 0.8);
    text(h, x + 1.4, y + 0.5, { font: F.monob, size: 18, color: hc, w: cw - 1.6 });
    text(big, x + 1.4, y + 0.95, { font: F.mono, size: 13, color: C.ink, w: cw - 1.6 });
    text("THRUST AUTHORITY", x + 0.4, y + 1.68, { font: F.mono, size: 9, color: C.dim, cs: 0.5 });
    rect(x + 0.4, y + 1.95, cw - 0.8, 0.34, "#0A0F1C", C.line, 1);
    rect(x + 0.4, y + 1.95, (cw - 0.8) * frac, 0.34, barc);
    text(d, x + 0.4, y + 2.5, { font: F.body, size: 13, color: C.dim, w: cw - 0.8, lineGap: 2 });
  });
  text("Thrust power is read from the brightness of the generated scene — exactly like a solar-electric satellite losing power in eclipse.", 0.6, 5.75, { font: F.bodyi, size: 14, color: C.ink, align: "center", w: 12.13 });
  note("Speaker: Thrust power is read from the brightness of the scene. Fly into shadow — like a real satellite entering eclipse — and solar-electric power drops, thrust weakens. The agent eases off and coasts until it brightens.");
  footer("05 · ~0:30");
}

// ============================================================ 6 HUMAN
function s6() {
  page(); bg(C.bg); tag("// 05  HUMAN ON THE LOOP"); title("Grab the stick, hand it back");
  const roles = [
    [I.robot, C.cyan, "AGENT", "Autopilot", "Plans and flies the minimum-Δv solution by default."],
    [I.hand, C.orange, "YOU", "Manual (press G)", "Take over to dodge by hand, then release control back."],
  ];
  const cw = 3.5, x0 = 0.6, y = 2.15, ch = 2.4, gap = 0.3;
  roles.forEach(([ic, col, h, sub, d], i) => {
    const x = x0 + i * (cw + gap);
    card(x, y, cw, ch);
    img(ic, x + 0.4, y + 0.4, 0.75, 0.75);
    text(h, x + 1.3, y + 0.44, { font: F.monob, size: 20, color: col, w: cw - 1.5 });
    text(sub, x + 1.3, y + 0.9, { font: F.mono, size: 11, color: C.dim, w: cw - 1.5 });
    text(d, x + 0.4, y + 1.42, { font: F.body, size: 13, color: C.ink, w: cw - 0.8, lineGap: 2 });
  });
  const lx = 8.2, lw = 4.5;
  card(lx, y, lw, ch, C.panel);
  text("Δv LEDGER", lx + 0.35, y + 0.32, { font: F.mono, size: 12, color: C.dim, cs: 1 });
  const tx = lx + 0.35, tw = lw - 0.7, ty = y + 0.95;
  rect(tx, ty, tw, 0.4, "#0A0F1C", C.line, 1);
  rect(tx, ty, tw * 0.5, 0.4, C.cyan);
  rect(tx + tw * 0.5, ty, tw * 0.12, 0.4, C.orange);
  line(tx + tw * 0.83, ty - 0.1, tx + tw * 0.83, ty + 0.5, C.dim, true, 1.5);
  text("par", tx + tw * 0.83 - 0.3, ty + 0.46, { font: F.mono, size: 9, color: C.dim, align: "center", w: 0.8 });
  rich([
    { text: "■ agent", color: C.cyan, font: F.mono },
    { text: "    ■ you", color: C.orange, font: F.mono },
  ], tx, ty + 0.78, tw, { size: 11 });
  text("Every encounter is graded A–F on Δv efficiency vs. the optimal burn.", lx + 0.35, y + 1.72, { font: F.bodyi, size: 12, color: C.dim, w: lw - 0.7, lineGap: 1 });
  text("Autonomy isn't all-or-nothing — the human-on-the-loop model real operations are moving toward.", 0.6, 5.75, { font: F.bodyi, size: 14, color: C.ink, align: "center", w: 12.13 });
  note("Speaker: Autonomy isn't all-or-nothing. Press G and you fly manually; release and the agent resumes. The Δv ledger tracks who spent what — agent vs. you — and grades the result against the optimal.");
  footer("06 · ~0:35");
}

// ============================================================ 7 REAL
function s7() {
  page(); bg(C.bg); tag("// 06  WHY IT MATTERS"); title("Maps to today's space operations");
  const stats = [["30,000+", "tracked objects in orbit", C.cyan], ["30+", "ISS debris-avoidance maneuvers", C.green], ["tens of thousands", "Starlink maneuvers / 6 months", C.orange]];
  const cw = 3.85, gap = 0.29, x0 = 0.6, y = 2.15, ch = 1.85;
  stats.forEach(([num, label, col], i) => {
    const x = x0 + i * (cw + gap);
    card(x, y, cw, ch); rect(x, y, cw, 0.09, col);
    vtext(num, x + 0.2, y + 0.32, cw - 0.4, 0.7, { font: F.monob, size: num.length > 8 ? 22 : 36, color: col, align: "center" });
    text(label, x + 0.2, y + 1.22, { font: F.body, size: 12.5, color: C.dim, align: "center", w: cw - 0.4 });
  });
  const rows = [
    [I.crosshair, "Conjunction screening", "The US Space Force issues Conjunction Data Messages keyed on TCA & miss distance — the same quantities in the game."],
    [I.robot, "Automated avoidance", "ESA and others are building AI-assisted collision-avoidance as object counts climb toward Kessler-syndrome risk."],
    [I.bolt, "Solar electric propulsion", "Ion & Hall thrusters fly today on Dawn, Starlink and GEO comsats — solar-powered, so they lose thrust in eclipse."],
  ];
  let yy = 4.35;
  for (const [ic, h, d] of rows) {
    img(ic, 0.7, yy + 0.03, 0.5, 0.5);
    rich([
      { text: h + "   ", color: C.ink, font: F.monob },
      { text: d, color: C.dim, font: F.body },
    ], 1.4, yy + 0.05, 11.3, { size: 13, lineGap: 1 });
    yy += 0.78;
  }
  note("Speaker: Every concept on screen is a real one. As object counts climb toward Kessler-syndrome risk, autonomous avoidance under propellant constraints stops being a game and becomes infrastructure.");
  footer("07 · ~0:45");
}

// ============================================================ 8 CLOSE
function s8() {
  page(); bg(C.bg);
  ring(11.6, 1.5, 0.95, C.line, 1);
  ring(11.6, 1.5, 0.62, C.cyan, 1, 0.5);
  dot(11.6, 1.5, 0.05, C.cyan);
  ring(1.7, 6.0, 1.1, C.line, 1);
  ring(1.7, 6.0, 0.7, C.green, 1, 0.5);
  text("// CLOSE", 0.7, 1.8, { font: F.monob, size: 12, color: C.cyan, cs: 1.5 });
  text("An agent that perceives, plans, and flies real physics —\ninside a world dreamed in real time.", 0.7, 2.35, { font: F.monob, size: 28, color: C.ink, w: 11.8, lineGap: 8 });
  text("Deterministic physics you can trust · A generative world you can't predict · An autonomous pilot reasoning between them.", 0.7, 4.55, { font: F.body, size: 14, color: C.dim, w: 11.5, lineGap: 2 });
  text("DRIFT 3D", 0.7, 5.35, { font: F.monob, size: 24, color: C.cyan, cs: 1 });
  text("Thank you — happy to take questions.", 0.7, 5.95, { font: F.bodyi, size: 15, color: C.dim });
  note("Speaker: Deterministic physics you can trust, a generative world you can't predict, and an autonomous pilot reasoning between them. That's DRIFT 3D.");
  footer("08 · ~0:25  ·  5:00 total");
}

async function main() {
  await loadIcons();
  const out = fs.createWriteStream("C:\\Users\\CSC\\Downloads\\DriftKing\\DRIFT_3D_Presentation.pdf");
  doc.pipe(out);
  s1(); s2(); s3(); s4(); s5(); s6(); s7(); s8();
  doc.end();
  await new Promise((r) => out.on("finish", r));
  console.log("written DRIFT_3D_Presentation.pdf");
}
main().catch((e) => { console.error(e); process.exit(1); });
