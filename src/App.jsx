import { useState, useMemo, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from "recharts";

// ── iOS SYSTEM COLORS (HIG dark mode) ────────────────────────
const C = {
  bg0:     '#000000',
  bg1:     '#1C1C1E',
  bg2:     '#2C2C2E',
  bg3:     '#3A3A3C',
  sep:     'rgba(84,84,88,0.65)',
  label:   '#FFFFFF',
  label2:  'rgba(235,235,245,0.6)',
  label3:  'rgba(235,235,245,0.3)',
  blue:    '#0A84FF',
  green:   '#30D158',
  orange:  '#FF9F0A',
  yellow:  '#FFD60A',
  indigo:  '#5E5CE6',
  purple:  '#BF5AF2',
  red:     '#FF453A',
  teal:    '#40CBE0',
  cyan:    '#32ADE6',
};

// ── PK CONSTANTS ─────────────────────────────────────────────
const LN2 = Math.LN2;
const MPH_KE = LN2 / 2.5;
const AMP_KE = LN2 / 11.0;

function bateman(t, ka, ke) {
  if (t <= 0) return 0;
  if (Math.abs(ka - ke) < 1e-4) return ka * t * Math.exp(-ke * t);
  return (ka / (ka - ke)) * (Math.exp(-ke * t) - Math.exp(-ka * t));
}

const MODELS = {
  "Ritalin IR":        (t, f) => bateman(Math.max(0, t - (f ? 1.0 : 0)), 2.0, MPH_KE),
  "Ritalin LA":        (t, f) => { const tl = f ? 1.0 : 0; return 0.5 * bateman(Math.max(0, t - tl), 2.0, MPH_KE) + 0.5 * bateman(Math.max(0, t - tl - 3.5), 0.7, MPH_KE); },
  "Medikinet CR":      (t, f) => { const tl = f ? 0.5 : 0; return 0.5 * bateman(Math.max(0, t - tl), 2.0, MPH_KE) + 0.5 * bateman(Math.max(0, t - tl - 3.0), 0.65, MPH_KE); },
  "Concerta":          (t, f) => { const tl = f ? 0.5 : 0; const te = Math.max(0, t - tl); const ir = 0.22 * bateman(te, 2.0, MPH_KE); const s0 = 0.5, s1 = 7.0, R = 0.78 / (s1 - s0); let oros = 0; if (te >= s1) { oros = (R / MPH_KE) * (1 - Math.exp(-MPH_KE * (s1 - s0))) * Math.exp(-MPH_KE * (te - s1)); } else if (te >= s0) { oros = (R / MPH_KE) * (1 - Math.exp(-MPH_KE * (te - s0))); } return ir + oros; },
  "Adderall IR":       (t, f) => bateman(Math.max(0, t - (f ? 0.5 : 0)), 1.2, AMP_KE),
  "Adderall XR":       (t, f) => { const tl = f ? 0.5 : 0; return 0.5 * bateman(Math.max(0, t - tl), 1.2, AMP_KE) + 0.5 * bateman(Math.max(0, t - tl - 4.0), 1.2, AMP_KE); },
  "Vyvanse / Elvanse": (t, f) => bateman(Math.max(0, t - (f ? 1.0 : 0)), 0.75, AMP_KE),
};

const MED_CFG = {
  "Ritalin IR":        { type: "MPH", color: C.indigo },
  "Ritalin LA":        { type: "MPH", color: C.purple },
  "Medikinet CR":      { type: "MPH", color: '#A78BFA' },
  "Concerta":          { type: "MPH", color: C.cyan },
  "Adderall IR":       { type: "AMP", color: C.orange },
  "Adderall XR":       { type: "AMP", color: C.yellow },
  "Vyvanse / Elvanse": { type: "AMP", color: C.red },
};

const ALL_MEDS = Object.keys(MED_CFG);
const MPH_MEDS = ALL_MEDS.filter(m => MED_CFG[m].type === "MPH");
const AMP_MEDS = ALL_MEDS.filter(m => MED_CFG[m].type === "AMP");

function caffModel(t, hl) {
  if (t <= 0) return 0;
  if (t < 0.75) return t / 0.75;
  return Math.exp(-(LN2 / hl) * (t - 0.75));
}

function nowH() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

function fmtH(h) {
  const n = ((h % 24) + 24) % 24;
  return `${String(Math.floor(n)).padStart(2, "0")}:${String(Math.round((n % 1) * 60)).padStart(2, "0")}`;
}

function toH(s) { const [h, m] = s.split(":").map(Number); return h + m / 60; }

function buildChart(doses, caffs, caffHL, preview, compare) {
  const N = 300, A = 5, B = 29;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const h = A + (B - A) * i / N;
    let mph = 0, amp = 0, caff = 0, pMph = 0, pAmp = 0, cMph = 0, cAmp = 0;
    doses.forEach(d => { const c = MODELS[d.med](h - d.time, d.food) * d.amount; MED_CFG[d.med].type === "MPH" ? (mph += c) : (amp += c); });
    caffs.forEach(c => { caff += c.amount * caffModel(h - c.time, caffHL); });
    if (preview) { const c = MODELS[preview.med](h - preview.time, preview.food) * preview.amount; MED_CFG[preview.med].type === "MPH" ? (pMph = mph + c) : (pAmp = amp + c); }
    if (compare) { const c = MODELS[compare.med](h - compare.time, compare.food) * compare.amount; MED_CFG[compare.med].type === "MPH" ? (cMph += c) : (cAmp += c); }
    return { h, mph, amp, caff, pMph, pAmp, cMph, cAmp };
  });
  const pk = k => Math.max(...pts.map(p => p[k]), 1e-9);
  const mphPk = pk("mph"), ampPk = pk("amp"), caffPk = pk("caff");
  const pMphPk = Math.max(pk("pMph"), mphPk), pAmpPk = Math.max(pk("pAmp"), ampPk);
  const cMphPk = pk("cMph"), cAmpPk = pk("cAmp");
  const norm = pts.map(p => ({
    h: p.h,
    mph:  mphPk  > 1e-8 ? p.mph  / mphPk  * 100 : 0,
    amp:  ampPk  > 1e-8 ? p.amp  / ampPk  * 100 : 0,
    caff: caffPk > 1e-8 ? p.caff / caffPk * 100 : 0,
    pMph: preview && MED_CFG[preview.med].type === "MPH" ? p.pMph / pMphPk * 100 : undefined,
    pAmp: preview && MED_CFG[preview.med].type === "AMP" ? p.pAmp / pAmpPk * 100 : undefined,
    cMph: compare && MED_CFG[compare.med].type === "MPH" ? p.cMph / cMphPk * 100 : undefined,
    cAmp: compare && MED_CFG[compare.med].type === "AMP" ? p.cAmp / cAmpPk * 100 : undefined,
  }));
  return { norm, caffPk };
}

function getSleep(norm, doses, caffs, caffPk, weight) {
  const hasMPH = doses.some(d => MED_CFG[d.med].type === "MPH");
  const hasAMP = doses.some(d => MED_CFG[d.med].type === "AMP");
  const thrPct = caffPk > 0 ? (weight * 0.6 / caffPk) * 100 : 999;
  const start = Math.max(nowH(), 16);
  for (const p of norm) {
    if (p.h < start) continue;
    if (hasMPH && p.mph > 18) continue;
    if (hasAMP && p.amp > 15) continue;
    if (caffs.length > 0 && p.caff > thrPct) continue;
    return p.h;
  }
  return null;
}

// ── PERSISTENCE ───────────────────────────────────────────────
const LS_KEY = "adhd_tl_v1";
function saveLS(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {} }
function loadLS() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function encodeShare(s) { try { return btoa(encodeURIComponent(JSON.stringify(s))); } catch { return ""; } }
function decodeShare(h) { try { return JSON.parse(decodeURIComponent(atob(h))); } catch { return null; } }

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 640);
    window.addEventListener("resize", fn, { passive: true });
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

// ── HIG COMPONENTS ────────────────────────────────────────────

// Segmented Control (HIG: use for 2–5 mutually exclusive options in context)
function SegmentedControl({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", background: C.bg2, borderRadius: 9, padding: 2, gap: 2 }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          flex: 1, border: "none", borderRadius: 7, padding: "7px 4px",
          fontSize: 13, fontWeight: active === k ? 600 : 400,
          color: active === k ? C.label : C.label2,
          background: active === k ? C.bg3 : "transparent",
          cursor: "pointer", transition: "background .15s, color .15s",
          whiteSpace: "nowrap", minHeight: 32,
          boxShadow: active === k ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );
}

// iOS-style Toggle (HIG: use system green for on state)
function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} role="switch" aria-checked={on} style={{
      width: 51, height: 31, borderRadius: 15.5,
      background: on ? C.green : C.bg3,
      position: "relative", cursor: "pointer", flexShrink: 0,
      transition: "background .2s",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
    }}>
      <div style={{
        position: "absolute", top: 2, left: on ? 22 : 2,
        width: 27, height: 27, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        transition: "left .2s",
      }} />
    </div>
  );
}

// Grouped Section wrapper (HIG: inset grouped style)
function Section({ title, footer, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 400, color: C.label2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingLeft: 16 }}>
          {title}
        </div>
      )}
      <div style={{ background: C.bg1, borderRadius: 12, overflow: "hidden" }}>
        {children}
      </div>
      {footer && (
        <div style={{ fontSize: 13, color: C.label2, marginTop: 8, paddingLeft: 16, paddingRight: 16, lineHeight: 1.5 }}>
          {footer}
        </div>
      )}
    </div>
  );
}

// Form row (HIG: 44pt min height, full-width, hairline separator)
function Row({ label, detail, children, last, onPress, destructive }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    minHeight: 44, padding: "10px 16px", gap: 12,
    borderBottom: last ? "none" : `1px solid ${C.sep}`,
    cursor: onPress ? "pointer" : "default",
  };
  return (
    <div style={base} onClick={onPress}>
      {label && (
        <span style={{ fontSize: 17, color: destructive ? C.red : C.label, flexShrink: 0 }}>{label}</span>
      )}
      {detail && (
        <span style={{ fontSize: 17, color: C.label2, marginLeft: "auto", marginRight: children ? 8 : 0 }}>{detail}</span>
      )}
      {children}
    </div>
  );
}

// Full-width slider row
function SliderRow({ label, value, min, max, step, onChange, color, last }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: last ? "none" : `1px solid ${C.sep}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 15, color: C.label }}>{label}</span>
        <span style={{ fontSize: 15, color: C.label2, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: color || C.blue, height: 4 }} />
    </div>
  );
}

// Primary CTA button (HIG: full-width only for primary action, capsule shape)
function PrimaryBtn({ children, onClick, color, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", border: "none", borderRadius: 12,
      padding: "14px 0", fontSize: 17, fontWeight: 600,
      color: "#fff", background: color || C.blue,
      cursor: "pointer", minHeight: 50,
      opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}

// Inline text button (HIG: for secondary/destructive actions)
function TextBtn({ children, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none",
      fontSize: 17, color: color || C.blue,
      cursor: "pointer", padding: "8px 0", minHeight: 44,
    }}>{children}</button>
  );
}

// iOS-style select (full row)
function SelectRow({ label, value, onChange, options, last }) {
  return (
    <div style={{ padding: "0 16px", borderBottom: last ? "none" : `1px solid ${C.sep}` }}>
      <div style={{ display: "flex", alignItems: "center", minHeight: 44, gap: 8 }}>
        <span style={{ fontSize: 17, color: C.label, flexShrink: 0, minWidth: 80 }}>{label}</span>
        <select value={value} onChange={e => onChange(e.target.value)} style={{
          flex: 1, background: "transparent", border: "none",
          color: C.label2, fontSize: 17, textAlign: "right",
          outline: "none", cursor: "pointer", direction: "rtl",
        }}>
          {options.map(([v, l]) => <option key={v} value={v} style={{ background: C.bg1, direction: "ltr" }}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}

// Time picker row
function TimeRow({ label, value, onChange, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", minHeight: 44, padding: "0 16px", gap: 8, borderBottom: last ? "none" : `1px solid ${C.sep}` }}>
      <span style={{ fontSize: 17, color: C.label, flex: 1 }}>{label}</span>
      <input type="time" value={value} onChange={e => onChange(e.target.value)} style={{
        background: "transparent", border: "none", color: C.label2,
        fontSize: 17, outline: "none", textAlign: "right",
      }} />
    </div>
  );
}

// Checkbox row
function CheckRow({ label, checked, onChange, last }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      display: "flex", alignItems: "center", minHeight: 44,
      padding: "0 16px", gap: 12, cursor: "pointer",
      borderBottom: last ? "none" : `1px solid ${C.sep}`,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 11, flexShrink: 0,
        background: checked ? C.blue : "transparent",
        border: checked ? "none" : `2px solid ${C.bg3}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .15s",
      }}>
        {checked && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✓</span>}
      </div>
      <span style={{ fontSize: 17, color: C.label }}>{label}</span>
    </div>
  );
}

// Stat badge (large number + label)
function StatBadge({ value, label, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 72, background: C.bg1, borderRadius: 14,
      padding: "12px 10px", textAlign: "center",
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: C.label3, marginTop: 3, letterSpacing: 0.2 }}>{label}</div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────
export default function App() {
  const mobile = useIsMobile();

  const [doses,  setDoses]  = useState([]);
  const [caffs,  setCaffs]  = useState([]);
  const [weight, setWeight] = useState(75);
  const [caffHL, setCaffHL] = useState(5);
  const [tw,     setTw]     = useState({ on: false, s: 9, e: 17 });
  const [tab,    setTab]    = useState("dose");
  const [warn,   setWarn]   = useState(null);
  const [copied, setCopied] = useState(false);

  const [dMed,  setDMed]  = useState("Ritalin LA");
  const [dAmt,  setDAmt]  = useState(20);
  const [dTime, setDTime] = useState("08:00");
  const [dFood, setDFood] = useState(false);

  const [cAmt,  setCAmt]  = useState(80);
  const [cTime, setCTime] = useState("09:00");

  const [prvOn, setPrvOn] = useState(false);
  const [pMed,  setPMed]  = useState("Ritalin IR");
  const [pAmt,  setPAmt]  = useState(10);
  const [pTime, setPTime] = useState("13:00");
  const [pFood, setPFood] = useState(false);

  const [cmpOn,   setCmpOn]   = useState(false);
  const [cMed,    setCMed]    = useState("Concerta");
  const [cmpAmt,  setCmpAmt]  = useState(36);
  const [cmpTime, setCmpTime] = useState("08:00");
  const [cmpFood, setCmpFood] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const s = decodeShare(hash);
      if (s) {
        if (s.doses)  setDoses(s.doses);
        if (s.caffs)  setCaffs(s.caffs);
        if (s.weight) setWeight(s.weight);
        if (s.caffHL) setCaffHL(s.caffHL);
        if (s.tw)     setTw(s.tw);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
    }
    const ls = loadLS();
    if (ls) {
      if (ls.doses)  setDoses(ls.doses);
      if (ls.caffs)  setCaffs(ls.caffs);
      if (ls.weight) setWeight(ls.weight);
      if (ls.caffHL) setCaffHL(ls.caffHL);
      if (ls.tw)     setTw(ls.tw);
    }
  }, []);

  useEffect(() => { saveLS({ doses, caffs, weight, caffHL, tw }); }, [doses, caffs, weight, caffHL, tw]);

  const shareURL = useCallback(() => {
    const hash = encodeShare({ doses, caffs, weight, caffHL, tw });
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }, [doses, caffs, weight, caffHL, tw]);

  const now = nowH();
  const previewObj = prvOn ? { med: pMed, amount: pAmt, time: toH(pTime), food: pFood } : null;
  const compareObj = cmpOn ? { med: cMed, amount: cmpAmt, time: toH(cmpTime), food: cmpFood } : null;

  const { norm, caffPk } = useMemo(
    () => buildChart(doses, caffs, caffHL, previewObj, compareObj),
    [doses, caffs, caffHL, prvOn, pMed, pAmt, pTime, pFood, cmpOn, cMed, cmpAmt, cmpTime, cmpFood]
  );

  const sleepT     = useMemo(() => getSleep(norm, doses, caffs, caffPk, weight), [norm, doses, caffs, caffPk, weight]);
  const caffThrPct = caffPk > 0 ? Math.min((weight * 0.6 / caffPk) * 100, 100) : 50;
  const cur        = norm.reduce((b, p) => Math.abs(p.h - now) < Math.abs(b.h - now) ? p : b, norm[0] ?? { mph: 0, amp: 0, caff: 0 });

  const hasMPH  = doses.some(d => MED_CFG[d.med].type === "MPH");
  const hasAMP  = doses.some(d => MED_CFG[d.med].type === "AMP");
  const hasCaff = caffs.length > 0;

  const addDose = () => {
    const t = toH(dTime);
    const type = MED_CFG[dMed].type;
    if (doses.some(d => MED_CFG[d.med].type === type)) {
      const pt = norm.find(p => Math.abs(p.h - t) < 0.1);
      if (pt && (type === "MPH" ? pt.mph : pt.amp) > 50)
        setWarn({ level: Math.round(type === "MPH" ? pt.mph : pt.amp), med: dMed });
    }
    setDoses(p => [...p, { id: Date.now(), med: dMed, amount: dAmt, time: t, food: dFood }]);
  };

  const ChartTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: C.bg2, borderRadius: 10, padding: "8px 12px", fontSize: 13, border: `1px solid ${C.sep}` }}>
        <div style={{ color: C.label2, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>{fmtH(payload[0]?.payload?.h)}</div>
        {payload.map((p, i) => p.value > 0.5 &&
          <div key={i} style={{ color: p.color, margin: "2px 0", fontVariantNumeric: "tabular-nums" }}>{p.name}: {Math.round(p.value)}%</div>
        )}
      </div>
    );
  };

  const medOptions = [
    ...MPH_MEDS.map(m => [m, m]),
    ...AMP_MEDS.map(m => [m, m]),
  ];

  const drinkOptions = [
    [30, "Espresso — 30 mg"],
    [60, "Double espresso — 60 mg"],
    [80, "Filter coffee 200ml — 80 mg"],
    [150, "Large coffee — 150 mg"],
    [40, "Green tea — 40 mg"],
    [80, "Black tea — 80 mg"],
    [35, "Cola 350ml — 35 mg"],
    [80, "Energy drink 250ml — 80 mg"],
    [160, "Energy drink 500ml — 160 mg"],
  ];

  const px = mobile ? 16 : 20;

  return (
    <div style={{
      background: C.bg0,
      minHeight: "100dvh",
      color: C.label,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
      WebkitFontSmoothing: "antialiased",
      paddingLeft: px, paddingRight: px,
      paddingTop: `max(${px}px, env(safe-area-inset-top, 0px))`,
      paddingBottom: `max(${px}px, env(safe-area-inset-bottom, 0px))`,
      maxWidth: 680,
      margin: "0 auto",
    }}>

      {/* ── Navigation bar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: mobile ? 28 : 34, fontWeight: 700, letterSpacing: 0.3, lineHeight: 1.1 }}>
            Medication Timeline
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.label3 }}>
            Estimated plasma concentration · Not medical advice
          </p>
        </div>
        <button onClick={shareURL} style={{
          background: copied ? C.green : C.bg1,
          border: "none", borderRadius: 20,
          color: copied ? "#fff" : C.blue,
          padding: "8px 14px", fontSize: 15, fontWeight: 500,
          cursor: "pointer", flexShrink: 0, marginLeft: 12,
          minHeight: 44, minWidth: 80, transition: "all .2s",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          {copied ? "✓ Copied" : "⎘ Share"}
        </button>
      </div>

      {/* ── Stacking warning (HIG: inline alert, not modal) ── */}
      {warn && (
        <div style={{
          background: 'rgba(255,69,58,0.15)', borderRadius: 12,
          padding: "12px 16px", marginBottom: 16,
          border: `1px solid rgba(255,69,58,0.3)`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.red, marginBottom: 2 }}>Dose stacking detected</div>
            <div style={{ fontSize: 13, color: C.label2 }}>{warn.med} was still at ~{warn.level}% when this dose was added</div>
          </div>
          <button onClick={() => setWarn(null)} style={{ background: "none", border: "none", color: C.label3, cursor: "pointer", fontSize: 20, minWidth: 44, minHeight: 44 }}>✕</button>
        </div>
      )}

      {/* ── Stat badges ── */}
      {(hasMPH || hasAMP || hasCaff || sleepT) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {hasMPH  && <StatBadge value={`${Math.round(cur.mph)}%`}  label="MPH now"       color={C.indigo} />}
          {hasAMP  && <StatBadge value={`${Math.round(cur.amp)}%`}  label="AMP now"       color={C.orange} />}
          {hasCaff && <StatBadge value={`${Math.round(cur.caff)}%`} label="Caffeine"      color={C.yellow} />}
          {sleepT  && <StatBadge value={fmtH(sleepT)}               label="Sleep-ready ~" color={C.green}  />}
        </div>
      )}

      {/* ── Chart ── */}
      <div style={{ background: C.bg1, borderRadius: 16, padding: "14px 4px 10px", marginBottom: 24 }}>
        <ResponsiveContainer width="100%" height={mobile ? 195 : 240}>
          <AreaChart data={norm} margin={{ top: 6, right: 14, left: -18, bottom: 0 }}>
            <defs>
              {[["mph", C.indigo], ["amp", C.orange], ["caff", C.yellow]].map(([k, c]) => (
                <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={c} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke={C.sep} vertical={false} />
            <XAxis dataKey="h" type="number" domain={[5, 29]}
              ticks={mobile ? [6, 9, 12, 15, 18, 21, 24] : [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]}
              tickFormatter={fmtH} tick={{ fill: C.label3, fontSize: mobile ? 10 : 11 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 105]} ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: C.label3, fontSize: mobile ? 10 : 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip content={<ChartTip />} />

            {tw.on && <ReferenceArea x1={tw.s} x2={tw.e} fill={C.green} fillOpacity={0.06} stroke={C.green} strokeOpacity={0.25} strokeDasharray="4 4" />}
            {hasMPH  && <ReferenceLine y={18} stroke={C.indigo} strokeDasharray="3 5" strokeOpacity={0.5} label={{ value: "sleep ↓", fill: C.indigo, fontSize: 9, position: "insideTopRight" }} />}
            {hasAMP  && <ReferenceLine y={15} stroke={C.orange} strokeDasharray="3 5" strokeOpacity={0.5} />}
            {hasCaff && <ReferenceLine y={caffThrPct} stroke={C.yellow} strokeDasharray="3 5" strokeOpacity={0.5} />}
            <ReferenceLine x={now} stroke={C.green} strokeWidth={1.5} strokeDasharray="3 4"
              label={{ value: "Now", fill: C.green, fontSize: 10, position: "insideTopRight" }} />
            {sleepT && <ReferenceLine x={sleepT} stroke={C.purple} strokeWidth={1.5} strokeDasharray="3 4"
              label={{ value: "Sleep", fill: C.purple, fontSize: 10, position: "insideTopRight" }} />}

            {cmpOn && MED_CFG[cMed].type === "MPH" && <Area type="monotone" dataKey="cMph" name="Compare" stroke={C.teal} strokeWidth={1.5} fill="none" dot={false} strokeDasharray="8 4" connectNulls />}
            {cmpOn && MED_CFG[cMed].type === "AMP" && <Area type="monotone" dataKey="cAmp" name="Compare" stroke={C.teal} strokeWidth={1.5} fill="none" dot={false} strokeDasharray="8 4" connectNulls />}
            {prvOn && MED_CFG[pMed].type === "MPH" && <Area type="monotone" dataKey="pMph" name="Preview" stroke={C.label2} strokeWidth={1.5} fill="none" dot={false} strokeDasharray="3 3" strokeOpacity={0.6} connectNulls />}
            {prvOn && MED_CFG[pMed].type === "AMP" && <Area type="monotone" dataKey="pAmp" name="Preview" stroke={C.label2} strokeWidth={1.5} fill="none" dot={false} strokeDasharray="3 3" strokeOpacity={0.6} connectNulls />}
            {hasMPH  && <Area type="monotone" dataKey="mph"  name="MPH"      stroke={C.indigo} strokeWidth={2.5} fill="url(#gmph)"  dot={false} connectNulls />}
            {hasAMP  && <Area type="monotone" dataKey="amp"  name="AMP"      stroke={C.orange} strokeWidth={2.5} fill="url(#gamp)"  dot={false} connectNulls />}
            {hasCaff && <Area type="monotone" dataKey="caff" name="Caffeine" stroke={C.yellow} strokeWidth={2}   fill="url(#gcaff)" dot={false} connectNulls />}
          </AreaChart>
        </ResponsiveContainer>

        {!hasMPH && !hasAMP && !hasCaff && (
          <p style={{ textAlign: "center", color: C.label3, fontSize: 15, margin: "0 0 8px" }}>Add a dose below to see your curve</p>
        )}

        {(hasMPH || hasAMP || hasCaff || prvOn || cmpOn || tw.on) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", paddingTop: 6, paddingBottom: 2, paddingLeft: 8, paddingRight: 8 }}>
            {hasMPH  && <span style={{ fontSize: 12, color: C.indigo }}>— MPH</span>}
            {hasAMP  && <span style={{ fontSize: 12, color: C.orange }}>— AMP</span>}
            {hasCaff && <span style={{ fontSize: 12, color: C.yellow }}>— Caffeine</span>}
            {prvOn   && <span style={{ fontSize: 12, color: C.label3 }}>- - Preview</span>}
            {cmpOn   && <span style={{ fontSize: 12, color: C.teal  }}>- - Compare</span>}
            {tw.on   && <span style={{ fontSize: 12, color: C.green }}>▪ Target window</span>}
          </div>
        )}
      </div>

      {/* ── Segmented Control (HIG: replaces top-of-card tabs) ── */}
      <div style={{ marginBottom: 20 }}>
        <SegmentedControl
          tabs={[["dose", "💊 Dose"], ["caffeine", "☕ Caffeine"], ["preview", "👁 Preview"], ["settings", "⚙ Settings"]]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {/* ── DOSE TAB ── */}
      {tab === "dose" && (
        <>
          <Section title="Formulation">
            <SelectRow label="Drug" value={dMed} onChange={setDMed}
              options={[
                ...MPH_MEDS.map(m => [m, m]),
                ...AMP_MEDS.map(m => [m, m]),
              ]} />
            <SliderRow label="Dose" value={`${dAmt} mg`} min={5} max={100} step={5}
              onChange={setDAmt} color={MED_CFG[dMed].color} last />
          </Section>
          <Section title="Timing">
            <TimeRow label="Taken at" value={dTime} onChange={setDTime} />
            <CheckRow label="Taken with food (delays absorption)" checked={dFood} onChange={setDFood} last />
          </Section>
          <PrimaryBtn onClick={addDose} color={C.blue}>Add Dose</PrimaryBtn>
        </>
      )}

      {/* ── CAFFEINE TAB ── */}
      {tab === "caffeine" && (
        <>
          <Section title="Drink">
            <SelectRow label="Type" value={cAmt} onChange={v => setCAmt(+v)}
              options={drinkOptions.map(([mg, l]) => [mg, l])} />
            <TimeRow label="Time" value={cTime} onChange={setCTime} last />
          </Section>
          <Section
            title="Your CYP1A2 metabolism"
            footer={`Sleep threshold: ${Math.round(weight * 0.6)} mg (${weight} kg × 0.6 mg/kg · adenosine receptor model)`}
          >
            <SliderRow
              label={caffHL <= 3.5 ? "Fast metabolizer" : caffHL <= 6 ? "Average metabolizer" : "Slow metabolizer"}
              value={`t½ ${caffHL}h`} min={2} max={9} step={0.5}
              onChange={setCaffHL} color={C.yellow} last />
          </Section>
          <PrimaryBtn onClick={() => setCaffs(p => [...p, { id: Date.now(), amount: cAmt, time: toH(cTime) }])} color={C.yellow}>
            Add Caffeine
          </PrimaryBtn>
        </>
      )}

      {/* ── PREVIEW TAB ── */}
      {tab === "preview" && (
        <>
          <Section
            title="What-if booster preview"
            footer="Explore how a hypothetical dose shifts your curve and sleep window — without committing it."
          >
            <Row label="Enable preview" last={!prvOn}>
              <Toggle on={prvOn} onChange={setPrvOn} />
            </Row>
            {prvOn && (
              <>
                <SelectRow label="Drug" value={pMed} onChange={setPMed}
                  options={medOptions} />
                <SliderRow label="Dose" value={`${pAmt} mg`} min={5} max={60} step={5}
                  onChange={setPAmt} color={MED_CFG[pMed].color} />
                <TimeRow label="Time" value={pTime} onChange={setPTime} />
                <CheckRow label="With food" checked={pFood} onChange={setPFood} last />
              </>
            )}
          </Section>
          {prvOn && (
            <PrimaryBtn color={C.green} onClick={() => {
              setDoses(p => [...p, { id: Date.now(), med: pMed, amount: pAmt, time: toH(pTime), food: pFood }]);
              setPrvOn(false);
            }}>
              Commit as Real Dose
            </PrimaryBtn>
          )}
        </>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === "settings" && (
        <>
          <Section title="Body">
            <SliderRow label="Weight" value={`${weight} kg`} min={40} max={130}
              onChange={setWeight} color={C.green} last />
          </Section>

          <Section title="Target window" footer="Shade the hours when you need coverage to see gaps in your curve.">
            <Row label="Show target window" last={!tw.on}>
              <Toggle on={tw.on} onChange={v => setTw(t => ({ ...t, on: v }))} />
            </Row>
            {tw.on && (
              <>
                <TimeRow label="Start" value={fmtH(tw.s)} onChange={e => setTw(t => ({ ...t, s: toH(e) }))} />
                <TimeRow label="End"   value={fmtH(tw.e)} onChange={e => setTw(t => ({ ...t, e: toH(e) }))} last />
              </>
            )}
          </Section>

          <Section title="Formulation compare" footer="Overlay a second formulation independently normalized — compare timing and coverage shape.">
            <Row label="Show comparison" last={!cmpOn}>
              <Toggle on={cmpOn} onChange={setCmpOn} />
            </Row>
            {cmpOn && (
              <>
                <SelectRow label="Drug" value={cMed} onChange={setCMed} options={medOptions} />
                <SliderRow label="Dose" value={`${cmpAmt} mg`} min={5} max={100} step={5}
                  onChange={setCmpAmt} color={C.teal} />
                <TimeRow label="Time" value={cmpTime} onChange={setCmpTime} />
                <CheckRow label="With food" checked={cmpFood} onChange={setCmpFood} last />
              </>
            )}
          </Section>

          <Section>
            <Row last destructive onPress={() => {
              if (window.confirm("Clear all doses and caffeine?")) { setDoses([]); setCaffs([]); }
            }}>
              <span style={{ fontSize: 17, color: C.red, width: "100%", textAlign: "center" }}>Clear All Doses</span>
            </Row>
          </Section>
        </>
      )}

      {/* ── Dose log ── */}
      {(doses.length > 0 || caffs.length > 0) && (
        <Section title="Today's log" footer=" ">
          {[...doses.map((d, i) => (
            <Row key={d.id} last={i === doses.length - 1 && caffs.length === 0}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: MED_CFG[d.med].color, flexShrink: 0, marginRight: 4 }} />
              <span style={{ fontSize: 15, flex: 1 }}>{d.med} {d.amount} mg</span>
              {d.food && <span style={{ fontSize: 13, color: C.label3, marginRight: 6 }}>🍽</span>}
              <span style={{ fontSize: 15, color: C.label2, marginRight: 8, fontVariantNumeric: "tabular-nums" }}>{fmtH(d.time)}</span>
              <button onClick={() => setDoses(p => p.filter(x => x.id !== d.id))}
                style={{ background: "none", border: "none", color: C.red, fontSize: 18, cursor: "pointer", minWidth: 36, minHeight: 36, padding: 0 }}>−</button>
            </Row>
          )), ...caffs.map((c, i) => (
            <Row key={c.id} last={i === caffs.length - 1}>
              <span style={{ fontSize: 15, marginRight: 4 }}>☕</span>
              <span style={{ fontSize: 15, flex: 1 }}>{c.amount} mg caffeine</span>
              <span style={{ fontSize: 15, color: C.label2, marginRight: 8, fontVariantNumeric: "tabular-nums" }}>{fmtH(c.time)}</span>
              <button onClick={() => setCaffs(p => p.filter(x => x.id !== c.id))}
                style={{ background: "none", border: "none", color: C.red, fontSize: 18, cursor: "pointer", minWidth: 36, minHeight: 36, padding: 0 }}>−</button>
            </Row>
          ))]}
        </Section>
      )}

      <p style={{ textAlign: "center", color: C.label3, fontSize: 11, lineHeight: 1.6, marginTop: 8, paddingBottom: 8 }}>
        MPH t½ 2.5h · d-AMP t½ 11h · Caffeine t½ adjustable<br />
        Individual pharmacokinetics vary. Consult your prescriber.
      </p>
    </div>
  );
}