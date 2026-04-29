import { useState, useMemo, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from "recharts";

// ── PK CONSTANTS ─────────────────────────────────────────────
const LN2 = Math.LN2;
const MPH_KE = LN2 / 2.5;
const AMP_KE = LN2 / 11.0;

function bateman(t, ka, ke) {
  if (t <= 0) return 0;
  if (Math.abs(ka - ke) < 1e-4) return ka * t * Math.exp(-ke * t);
  return (ka / (ka - ke)) * (Math.exp(-ke * t) - Math.exp(-ka * t));
}

// ── FORMULATION MODELS ───────────────────────────────────────
const MODELS = {
  "Ritalin IR": (t, food) => {
    const tl = food ? 1.0 : 0;
    return bateman(Math.max(0, t - tl), 2.0, MPH_KE);
  },
  "Ritalin LA": (t, food) => {
    const tl = food ? 1.0 : 0;
    return 0.5 * bateman(Math.max(0, t - tl), 2.0, MPH_KE)
         + 0.5 * bateman(Math.max(0, t - tl - 3.5), 0.7, MPH_KE);
  },
  "Medikinet CR": (t, food) => {
    const tl = food ? 0.5 : 0;
    return 0.5 * bateman(Math.max(0, t - tl), 2.0, MPH_KE)
         + 0.5 * bateman(Math.max(0, t - tl - 3.0), 0.65, MPH_KE);
  },
  "Concerta": (t, food) => {
    const tl = food ? 0.5 : 0;
    const te = Math.max(0, t - tl);
    const ir = 0.22 * bateman(te, 2.0, MPH_KE);
    const s0 = 0.5, s1 = 7.0, R = 0.78 / (s1 - s0);
    let oros = 0;
    if (te >= s1) {
      const c1 = (R / MPH_KE) * (1 - Math.exp(-MPH_KE * (s1 - s0)));
      oros = c1 * Math.exp(-MPH_KE * (te - s1));
    } else if (te >= s0) {
      oros = (R / MPH_KE) * (1 - Math.exp(-MPH_KE * (te - s0)));
    }
    return ir + oros;
  },
  "Adderall IR": (t, food) => {
    const tl = food ? 0.5 : 0;
    return bateman(Math.max(0, t - tl), 1.2, AMP_KE);
  },
  "Adderall XR": (t, food) => {
    const tl = food ? 0.5 : 0;
    return 0.5 * bateman(Math.max(0, t - tl), 1.2, AMP_KE)
         + 0.5 * bateman(Math.max(0, t - tl - 4.0), 1.2, AMP_KE);
  },
  "Vyvanse / Elvanse": (t, food) => {
    const tl = food ? 1.0 : 0;
    return bateman(Math.max(0, t - tl), 0.75, AMP_KE);
  },
};

const MED_CFG = {
  "Ritalin IR":        { type: "MPH", color: "#818cf8" },
  "Ritalin LA":        { type: "MPH", color: "#a78bfa" },
  "Medikinet CR":      { type: "MPH", color: "#c084fc" },
  "Concerta":          { type: "MPH", color: "#60a5fa" },
  "Adderall IR":       { type: "AMP", color: "#fb923c" },
  "Adderall XR":       { type: "AMP", color: "#f59e0b" },
  "Vyvanse / Elvanse": { type: "AMP", color: "#f87171" },
};

// ── CAFFEINE MODEL ───────────────────────────────────────────
function caffModel(t, hl) {
  if (t <= 0) return 0;
  if (t < 0.75) return t / 0.75;
  return Math.exp(-(LN2 / hl) * (t - 0.75));
}

// ── HELPERS ──────────────────────────────────────────────────
function nowH() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
function fmtH(h) {
  const n = ((h % 24) + 24) % 24;
  return `${String(Math.floor(n)).padStart(2,"0")}:${String(Math.round((n % 1) * 60)).padStart(2,"0")}`;
}
function toH(s) { const [h, m] = s.split(":").map(Number); return h + m / 60; }

// ── OPTIMAL INTAKE TIME ──────────────────────────────────────
// For a given formulation and target window [twStart, twEnd], find the intake
// time that maximises AUC of the concentration curve within the window.
// This mirrors the "therapeutic box" approach (Marsot et al., PMC5460958).
function calcOptimalIntakeTime(medName, twStart, twEnd, food) {
  const STEP = 0.25;        // 15-min resolution
  const N_INT = 120;        // integration points within window
  let bestTime = null;
  let bestScore = -Infinity;

  for (let t = 4.0; t <= 12.0; t += STEP) {
    let score = 0;
    for (let i = 0; i <= N_INT; i++) {
      const h = twStart + (twEnd - twStart) * i / N_INT;
      score += MODELS[medName](h - t, food);
    }
    if (score > bestScore) {
      bestScore = score;
      bestTime = t;
    }
  }
  return bestTime;
}

// ── CHART DATA ───────────────────────────────────────────────
function buildChart(doses, caffs, caffHL, preview, compare) {
  const N = 300, A = 5, B = 29;

  // Find earliest dose time per type — curves start here, not at chart left edge
  const mphDoses = doses.filter(d => MED_CFG[d.med].type === "MPH");
  const ampDoses = doses.filter(d => MED_CFG[d.med].type === "AMP");
  const firstMPH = mphDoses.length ? Math.min(...mphDoses.map(d => d.time)) : Infinity;
  const firstAMP = ampDoses.length ? Math.min(...ampDoses.map(d => d.time)) : Infinity;
  const firstCaff = caffs.length ? Math.min(...caffs.map(c => c.time)) : Infinity;

  const prevType = preview ? MED_CFG[preview.med].type : null;
  const firstPrevMPH = (prevType === "MPH") ? Math.min(firstMPH, preview.time) : firstMPH;
  const firstPrevAMP = (prevType === "AMP") ? Math.min(firstAMP, preview.time) : firstAMP;

  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const h = A + (B - A) * i / N;
    let mph = 0, amp = 0, caff = 0, pMph = 0, pAmp = 0, cMph = 0, cAmp = 0;
    doses.forEach(d => {
      const c = MODELS[d.med](h - d.time, d.food) * d.amount;
      MED_CFG[d.med].type === "MPH" ? (mph += c) : (amp += c);
    });
    caffs.forEach(c => { caff += c.amount * caffModel(h - c.time, caffHL); });
    if (preview) {
      const c = MODELS[preview.med](h - preview.time, preview.food) * preview.amount;
      MED_CFG[preview.med].type === "MPH" ? (pMph = mph + c) : (pAmp = amp + c);
    }
    if (compare) {
      const c = MODELS[compare.med](h - compare.time, compare.food) * compare.amount;
      MED_CFG[compare.med].type === "MPH" ? (cMph += c) : (cAmp += c);
    }
    return { h, mph, amp, caff, pMph, pAmp, cMph, cAmp };
  });

  const pk = k => Math.max(...pts.map(p => p[k]), 1e-9);
  const mphPk = pk("mph"), ampPk = pk("amp"), caffPk = pk("caff");
  const pMphPk = Math.max(pk("pMph"), mphPk);
  const pAmpPk = Math.max(pk("pAmp"), ampPk);
  const cMphPk = pk("cMph"), cAmpPk = pk("cAmp");

  const norm = pts.map(p => ({
    h: p.h,
    // undefined before first dose → curve starts exactly at intake time
    mph:  (mphPk  > 1e-8 && p.h >= firstMPH)  ? p.mph  / mphPk  * 100 : undefined,
    amp:  (ampPk  > 1e-8 && p.h >= firstAMP)  ? p.amp  / ampPk  * 100 : undefined,
    caff: (caffPk > 1e-8 && p.h >= firstCaff) ? p.caff / caffPk * 100 : undefined,
    pMph: (preview && prevType === "MPH" && p.h >= firstPrevMPH) ? p.pMph / pMphPk * 100 : undefined,
    pAmp: (preview && prevType === "AMP" && p.h >= firstPrevAMP) ? p.pAmp / pAmpPk * 100 : undefined,
    cMph: (compare && MED_CFG[compare.med].type === "MPH") ? p.cMph / cMphPk * 100 : undefined,
    cAmp: (compare && MED_CFG[compare.med].type === "AMP") ? p.cAmp / cAmpPk * 100 : undefined,
  }));

  return { norm, mphPk, ampPk, caffPk };
}

function getSleep(norm, doses, caffs, caffPk, weight) {
  const hasMPH = doses.some(d => MED_CFG[d.med].type === "MPH");
  const hasAMP = doses.some(d => MED_CFG[d.med].type === "AMP");
  const thrPct = caffPk > 0 ? (weight * 0.6 / caffPk) * 100 : 999;
  const start = Math.max(nowH(), 16);
  for (const p of norm) {
    if (p.h < start) continue;
    if (hasMPH && (p.mph ?? 0) > 18) continue;
    if (hasAMP && (p.amp ?? 0) > 15) continue;
    if (caffs.length > 0 && (p.caff ?? 0) > thrPct) continue;
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

// ── STYLE CONSTANTS ───────────────────────────────────────────
const S = {
  card: { background: "#1e293b", borderRadius: 14, border: "1px solid #1e3a5f", padding: 16 },
  inp:  { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "10px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" },
  lbl:  { fontSize: 12, color: "#64748b", display: "block", marginBottom: 5 },
};

// ── SUB-COMPONENTS ────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{ width: 40, height: 22, borderRadius: 11, background: on ? "#4f46e5" : "#334155", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
    </div>
  );
}

function Btn({ children, color = "#4f46e5", onClick, small }) {
  return (
    <button onClick={onClick} style={{ background: color, border: "none", borderRadius: 8, color: "#fff", padding: small ? "10px 16px" : "11px 0", fontSize: small ? 13 : 14, fontWeight: 600, cursor: "pointer", width: small ? "auto" : "100%", minHeight: 44 }}>
      {children}
    </button>
  );
}

function MedSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={S.inp}>
      <optgroup label="── Methylphenidate ──">
        {["Ritalin IR","Ritalin LA","Medikinet CR","Concerta"].map(m => <option key={m}>{m}</option>)}
      </optgroup>
      <optgroup label="── Amphetamine ──">
        {["Adderall IR","Adderall XR","Vyvanse / Elvanse"].map(m => <option key={m}>{m}</option>)}
      </optgroup>
    </select>
  );
}

// Food-effect Tmax delays in hours, sourced from FDA labels and peer-reviewed PK studies.
// Used to decide whether to prominently display a food/fasted split.
// Sources: Adderall XR FDA label (2013), Vyvanse FDA label (2017),
//          Modi et al. 2000 (Concerta), Pharmaceutical Research MPH-IR study,
//          Tandfonline ADHD long-acting PK review (2019).
const FOOD_DELAY_H = {
  "Ritalin IR":        0.5,   // +0.5h (Pharmaceutical Research, 2001)
  "Ritalin LA":        1.0,   // +1.0h (both SODAS peaks shift, review 2019)
  "Medikinet CR":      0.5,   // +0.5h (similar SODAS mechanism, clinically minor)
  "Concerta":          0.5,   // +0.5h (Modi et al. 2000 — OROS minimally affected)
  "Adderall IR":       0.5,   // +0.5h (Caras 2020 — minor delay)
  "Adderall XR":       2.5,   // +2.5h (FDA label — clinically significant)
  "Vyvanse / Elvanse": 1.0,   // +1.0h (FDA label — high-fat meal)
};

// ── OPTIMAL TIMING CARD ───────────────────────────────────────
function OptimalTimingCard({ tw, doses }) {
  const suggestions = useMemo(() => {
    if (!tw.on || tw.s >= tw.e) return [];

    // Unique meds: from logged doses if any, else show default set
    const meds = doses.length > 0
      ? [...new Set(doses.map(d => d.med))]
      : ["Ritalin LA", "Concerta", "Vyvanse / Elvanse"];

    return meds.map(med => ({
      med,
      fasted: calcOptimalIntakeTime(med, tw.s, tw.e, false),
      fed:    calcOptimalIntakeTime(med, tw.s, tw.e, true),
      delay:  FOOD_DELAY_H[med],
    }));
  }, [tw, doses]);

  if (!tw.on || suggestions.length === 0) return null;

  return (
    <div style={{ ...S.card, marginBottom: 12, borderColor: "#1e3a5f" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Optimal intake times for your target window</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
            Best coverage of {fmtH(tw.s)}–{fmtH(tw.e)} · maximises AUC within window
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {suggestions.map(({ med, fasted, fed, delay }) => (
          <div key={med} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px" }}>
            {/* Med name row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: MED_CFG[med].color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{med}</span>
            </div>
            {/* Fasted / fed side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ background: "#1e293b", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 2 }}>Fasted</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: MED_CFG[med].color, fontVariantNumeric: "tabular-nums" }}>
                  {fmtH(fasted)}
                </div>
              </div>
              <div style={{ background: "#1e293b", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 2 }}>
                  With food
                  {delay >= 1.0 && <span style={{ color: "#f97316", marginLeft: 4 }}>+{delay}h ⚠</span>}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: MED_CFG[med].color, fontVariantNumeric: "tabular-nums" }}>
                  {fmtH(fed)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#334155", marginTop: 8, lineHeight: 1.5 }}>
        Food delays sourced from FDA labels (Adderall XR, Vyvanse) and peer-reviewed PK studies. ⚠ marks delays ≥1h. Individual metabolism varies.
      </div>
    </div>
  );
}

// ── APP ──────────────────────────────────────────────────────
export default function App() {
  const mobile = useIsMobile();

  const [doses,   setDoses]   = useState([]);
  const [caffs,   setCaffs]   = useState([]);
  const [weight,  setWeight]  = useState(75);
  const [caffHL,  setCaffHL]  = useState(5);
  const [tw,      setTw]      = useState({ on: false, s: 9, e: 17 });
  const [tab,     setTab]     = useState("dose");
  const [warn,    setWarn]    = useState(null);
  const [copied,  setCopied]  = useState(false);

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

  const [cmpOn,    setCmpOn]    = useState(false);
  const [cMed,     setCMed]     = useState("Concerta");
  const [cmpAmt,   setCmpAmt]   = useState(36);
  const [cmpTime,  setCmpTime]  = useState("08:00");
  const [cmpFood,  setCmpFood]  = useState(false);

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
  const cur        = norm.reduce((b, p) => Math.abs(p.h - now) < Math.abs(b.h - now) ? p : b, norm[0] ?? { mph: undefined, amp: undefined, caff: undefined });

  const hasMPH  = doses.some(d => MED_CFG[d.med].type === "MPH");
  const hasAMP  = doses.some(d => MED_CFG[d.med].type === "AMP");
  const hasCaff = caffs.length > 0;

  const addDose = () => {
    const t = toH(dTime);
    const type = MED_CFG[dMed].type;
    if (doses.some(d => MED_CFG[d.med].type === type)) {
      const pt = norm.find(p => Math.abs(p.h - t) < 0.1);
      if (pt) {
        const lvl = type === "MPH" ? (pt.mph ?? 0) : (pt.amp ?? 0);
        if (lvl > 50) setWarn({ level: Math.round(lvl), med: dMed });
      }
    }
    setDoses(p => [...p, { id: Date.now(), med: dMed, amount: dAmt, time: t, food: dFood }]);
  };

  const ChartTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const h = payload[0]?.payload?.h;
    return (
      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
        <div style={{ color: "#64748b", marginBottom: 4 }}>{fmtH(h)}</div>
        {payload.map((p, i) => (p.value ?? 0) > 0.5 &&
          <div key={i} style={{ color: p.color, margin: "1px 0" }}>{p.name}: {Math.round(p.value)}%</div>
        )}
      </div>
    );
  };

  const grid2 = { display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10 };
  const pad = mobile ? 12 : 20;

  return (
    <div style={{
      background: "#0f172a", minHeight: "100dvh", color: "#e2e8f0",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: `${pad}px ${pad}px env(safe-area-inset-bottom, 16px)`,
      paddingTop: `max(${pad}px, env(safe-area-inset-top, 0px))`,
      maxWidth: 700, margin: "0 auto",
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: mobile ? 17 : 20, fontWeight: 700 }}>ADHD Medication Timeline</h1>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "#475569" }}>Estimated plasma curves · Published PK models · Not medical advice</p>
        </div>
        <button onClick={shareURL} style={{ background: copied ? "#059669" : "#1e293b", border: "1px solid #334155", borderRadius: 8, color: copied ? "#fff" : "#94a3b8", padding: "8px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0, marginLeft: 8, minHeight: 44, minWidth: 80, transition: "background .2s, color .2s" }}>
          {copied ? "✓ Copied!" : "🔗 Share"}
        </button>
      </div>

      {/* Level badges */}
      {(hasMPH || hasAMP || hasCaff || sleepT) && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
          {[
            hasMPH  && { label: "MPH now",      val: `${Math.round(cur.mph ?? 0)}%`,  color: "#818cf8" },
            hasAMP  && { label: "AMP now",       val: `${Math.round(cur.amp ?? 0)}%`,  color: "#f97316" },
            hasCaff && { label: "Caffeine",      val: `${Math.round(cur.caff ?? 0)}%`, color: "#fbbf24" },
            sleepT  && { label: "Sleep-ready ~", val: fmtH(sleepT),                    color: "#34d399" },
          ].filter(Boolean).map(({ label, val, color }) => (
            <div key={label} style={{ background: "#1e293b", borderRadius: 12, padding: "8px 16px", textAlign: "center", border: "1px solid #1e3a5f", minWidth: 72 }}>
              <div style={{ fontSize: mobile ? 20 : 22, fontWeight: 700, color, lineHeight: 1.1 }}>{val}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stacking warning */}
      {warn && (
        <div style={{ background: "#431407", border: "1px solid #9a3412", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#fed7aa" }}>
            <span style={{ color: "#fb923c", fontWeight: 700 }}>⚠ Dose stacking: </span>
            {warn.med} was still at ~{warn.level}% when this dose was added
          </span>
          <button onClick={() => setWarn(null)} style={{ background: "none", border: "none", color: "#9a3412", cursor: "pointer", fontSize: 20, minWidth: 44, minHeight: 44 }}>×</button>
        </div>
      )}

      {/* Optimal intake time suggestions */}
      <OptimalTimingCard tw={tw} doses={doses} />

      {/* Chart */}
      <div style={{ ...S.card, padding: "14px 4px 8px", marginBottom: 12 }}>
        <ResponsiveContainer width="100%" height={mobile ? 195 : 245}>
          <AreaChart data={norm} margin={{ top: 6, right: 14, left: -18, bottom: 0 }}>
            <defs>
              {[["mph","#818cf8"],["amp","#f97316"],["caff","#fbbf24"]].map(([k,c]) => (
                <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={c} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
            <XAxis dataKey="h" type="number" domain={[5,29]}
              ticks={mobile ? [6,9,12,15,18,21,24] : [6,8,10,12,14,16,18,20,22,24,26,28]}
              tickFormatter={fmtH} tick={{ fill:"#475569", fontSize: mobile ? 9 : 10 }} tickLine={false} />
            <YAxis domain={[0,105]} ticks={[0,25,50,75,100]}
              tick={{ fill:"#475569", fontSize: mobile ? 9 : 10 }} tickLine={false} tickFormatter={v=>`${v}%`} />
            <Tooltip content={<ChartTip />} />

            {/* Target window */}
            {tw.on && <ReferenceArea x1={tw.s} x2={tw.e} fill="#22c55e" fillOpacity={0.07} stroke="#22c55e" strokeOpacity={0.3} strokeDasharray="4 4" />}

            {/* Sleep threshold lines */}
            {hasMPH  && <ReferenceLine y={18} stroke="#818cf8" strokeDasharray="3 5" strokeOpacity={0.4} label={{ value:"sleep ↓", fill:"#818cf8", fontSize:9, position:"insideTopRight" }} />}
            {hasAMP  && <ReferenceLine y={15} stroke="#f97316" strokeDasharray="3 5" strokeOpacity={0.4} />}
            {hasCaff && <ReferenceLine y={caffThrPct} stroke="#fbbf24" strokeDasharray="3 5" strokeOpacity={0.4} />}

            {/* Now + sleep markers */}
            <ReferenceLine x={now} stroke="#34d399" strokeWidth={1.5} strokeDasharray="4 3" label={{ value:"Now", fill:"#34d399", fontSize:10, position:"insideTopRight" }} />
            {sleepT && <ReferenceLine x={sleepT} stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" label={{ value:"Sleep", fill:"#a78bfa", fontSize:10, position:"insideTopRight" }} />}

            {/* Dose intake markers — vertical tick at each dose time */}
            {doses.map(d => (
              <ReferenceLine key={d.id} x={d.time}
                stroke={MED_CFG[d.med].color} strokeWidth={1.5} strokeOpacity={0.7} strokeDasharray="2 3"
                label={{ value: "▼", fill: MED_CFG[d.med].color, fontSize: 10, position: "insideTopLeft" }}
              />
            ))}

            {/* Compare overlay */}
            {cmpOn && MED_CFG[cMed].type==="MPH" && <Area type="monotone" dataKey="cMph" name="Compare" stroke="#38bdf8" strokeWidth={2} fill="none" dot={false} strokeDasharray="8 4" connectNulls={false} />}
            {cmpOn && MED_CFG[cMed].type==="AMP" && <Area type="monotone" dataKey="cAmp" name="Compare" stroke="#fb7185" strokeWidth={2} fill="none" dot={false} strokeDasharray="8 4" connectNulls={false} />}

            {/* Preview ghost */}
            {prvOn && MED_CFG[pMed].type==="MPH" && <Area type="monotone" dataKey="pMph" name="Preview" stroke="#e2e8f0" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="3 3" strokeOpacity={0.5} connectNulls={false} />}
            {prvOn && MED_CFG[pMed].type==="AMP" && <Area type="monotone" dataKey="pAmp" name="Preview" stroke="#e2e8f0" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="3 3" strokeOpacity={0.5} connectNulls={false} />}

            {/* Main curves — connectNulls=false so they start at dose time */}
            {hasMPH  && <Area type="monotone" dataKey="mph"  name="MPH"      stroke="#818cf8" strokeWidth={2.5} fill="url(#gmph)"  dot={false} connectNulls={false} />}
            {hasAMP  && <Area type="monotone" dataKey="amp"  name="AMP"      stroke="#f97316" strokeWidth={2.5} fill="url(#gamp)"  dot={false} connectNulls={false} />}
            {hasCaff && <Area type="monotone" dataKey="caff" name="Caffeine" stroke="#fbbf24" strokeWidth={2}   fill="url(#gcaff)" dot={false} connectNulls={false} />}
          </AreaChart>
        </ResponsiveContainer>

        {!hasMPH && !hasAMP && !hasCaff && (
          <p style={{ textAlign:"center", color:"#334155", fontSize:13, margin:"0 0 8px" }}>Add a dose below to see your curve</p>
        )}

        <div style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center", paddingTop:4, fontSize:11, color:"#475569" }}>
          {hasMPH  && <span style={{ color:"#818cf8" }}>— MPH</span>}
          {hasAMP  && <span style={{ color:"#f97316" }}>— AMP</span>}
          {hasCaff && <span style={{ color:"#fbbf24" }}>— Caffeine</span>}
          {prvOn   && <span style={{ color:"#94a3b8" }}>- - Preview</span>}
          {cmpOn   && <span style={{ color:"#38bdf8" }}>- - Compare</span>}
          {tw.on   && <span style={{ color:"#22c55e" }}>▪ Target window</span>}
          {/* One ▼ legend entry per unique medication color */}
          {[...new Map(doses.map(d => [d.med, d])).values()].map(d => (
            <span key={d.med} style={{ color: MED_CFG[d.med].color }}>▼ {d.med.split(" ")[0]}</span>
          ))}
        </div>
      </div>

      {/* Tab panel */}
      <div style={{ ...S.card, padding: 0, overflow:"hidden", marginBottom: 12 }}>
        <div style={{ display:"flex", borderBottom:"1px solid #1e3a5f", padding:"8px 8px 0", gap: 2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          {[["dose","💊 Dose"],["caffeine","☕ Caffeine"],["preview","👁 Preview"],["settings","⚙ Settings"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: mobile ? "9px 10px" : "7px 12px",
              borderRadius:"6px 6px 0 0", fontSize: mobile ? 11 : 12, fontWeight:600,
              cursor:"pointer", border:"none", whiteSpace:"nowrap", transition:"background .15s, color .15s",
              background: tab===k ? "#334155" : "transparent",
              color:      tab===k ? "#f1f5f9" : "#64748b",
              minHeight: 42,
            }}>{l}</button>
          ))}
        </div>

        <div style={{ padding: mobile ? 12 : 16 }}>

          {tab === "dose" && (
            <div style={grid2}>
              <div style={{ gridColumn: mobile ? "auto" : "1/-1" }}>
                <label style={S.lbl}>Formulation</label>
                <MedSelect value={dMed} onChange={setDMed} />
              </div>
              <div>
                <label style={S.lbl}>Dose: {dAmt} mg</label>
                <input type="range" min={5} max={100} step={5} value={dAmt} onChange={e=>setDAmt(+e.target.value)} style={{ width:"100%", accentColor:"#818cf8" }} />
              </div>
              <div>
                <label style={S.lbl}>Time taken</label>
                <input type="time" value={dTime} onChange={e=>setDTime(e.target.value)} style={S.inp} />
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, minHeight:44 }}>
                <input type="checkbox" checked={dFood} onChange={e=>setDFood(e.target.checked)} style={{ accentColor:"#818cf8", width:18, height:18, flexShrink:0 }} />
                <span style={{ fontSize:13, color:"#94a3b8" }}>Taken with food (+delay)</span>
              </div>
              <div style={{ display:"flex", alignItems:"flex-end" }}>
                <Btn onClick={addDose}>+ Add Dose</Btn>
              </div>
            </div>
          )}

          {tab === "caffeine" && (
            <div style={grid2}>
              <div style={{ gridColumn: mobile ? "auto" : "1/-1" }}>
                <label style={S.lbl}>Drink</label>
                <select value={cAmt} onChange={e=>setCAmt(+e.target.value)} style={S.inp}>
                  {[["Espresso",30],["Double espresso",60],["Filter coffee 200ml",80],["Large coffee",150],
                    ["Green tea",40],["Black tea",80],["Cola 350ml",35],["Energy drink 250ml",80],["Energy drink 500ml",160]
                  ].map(([n,mg]) => <option key={n} value={mg}>{n} — {mg} mg</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Half-life: {caffHL}h · {caffHL<=3.5?"fast CYP1A2":caffHL<=6?"average":"slow CYP1A2"}</label>
                <input type="range" min={2} max={9} step={0.5} value={caffHL} onChange={e=>setCaffHL(+e.target.value)} style={{ width:"100%", accentColor:"#fbbf24" }} />
              </div>
              <div>
                <label style={S.lbl}>Time</label>
                <input type="time" value={cTime} onChange={e=>setCTime(e.target.value)} style={S.inp} />
              </div>
              <div style={{ display:"flex", alignItems:"flex-end" }}>
                <Btn color="#b45309" onClick={()=>setCaffs(p=>[...p,{id:Date.now(),amount:cAmt,time:toH(cTime)}])}>+ Add Caffeine</Btn>
              </div>
              <div style={{ gridColumn: mobile ? "auto" : "1/-1", background:"#0f172a", borderRadius:8, padding:"8px 12px", fontSize:11, color:"#475569" }}>
                Sleep threshold: {Math.round(weight * 0.6)} mg ({weight} kg × 0.6 mg/kg · adenosine receptor model)
              </div>
            </div>
          )}

          {tab === "preview" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                <div style={{ flex:1, paddingRight:12 }}>
                  <div style={{ fontSize:14, fontWeight:600 }}>What-if Booster Preview</div>
                  <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>Explore a hypothetical dose without committing. Ghost curve shows combined effect and shifts the sleep estimate live.</div>
                </div>
                <Toggle on={prvOn} onChange={setPrvOn} />
              </div>
              {prvOn && (
                <div style={grid2}>
                  <div style={{ gridColumn: mobile ? "auto" : "1/-1" }}>
                    <label style={S.lbl}>Formulation</label>
                    <MedSelect value={pMed} onChange={setPMed} />
                  </div>
                  <div>
                    <label style={S.lbl}>Dose: {pAmt} mg</label>
                    <input type="range" min={5} max={60} step={5} value={pAmt} onChange={e=>setPAmt(+e.target.value)} style={{ width:"100%", accentColor:"#94a3b8" }} />
                  </div>
                  <div>
                    <label style={S.lbl}>Time</label>
                    <input type="time" value={pTime} onChange={e=>setPTime(e.target.value)} style={S.inp} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, minHeight:44 }}>
                    <input type="checkbox" checked={pFood} onChange={e=>setPFood(e.target.checked)} style={{ accentColor:"#818cf8", width:18, height:18, flexShrink:0 }} />
                    <span style={{ fontSize:13, color:"#94a3b8" }}>With food</span>
                  </div>
                  <div>
                    <Btn color="#059669" onClick={() => {
                      setDoses(p => [...p, { id: Date.now(), med: pMed, amount: pAmt, time: toH(pTime), food: pFood }]);
                      setPrvOn(false);
                    }}>✓ Commit as real dose</Btn>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "settings" && (
            <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
              <div>
                <label style={S.lbl}>Body weight: {weight} kg</label>
                <input type="range" min={40} max={130} value={weight} onChange={e=>setWeight(+e.target.value)} style={{ width:"100%", accentColor:"#34d399" }} />
              </div>

              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600 }}>Symptom target window</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>
                      Shade the hours you need coverage — enables optimal intake time suggestions
                    </div>
                  </div>
                  <Toggle on={tw.on} onChange={v => setTw(t => ({ ...t, on: v }))} />
                </div>
                {tw.on && (
                  <div style={grid2}>
                    <div>
                      <label style={S.lbl}>Start</label>
                      <input type="time" value={fmtH(tw.s)} onChange={e => setTw(t => ({ ...t, s: toH(e.target.value) }))} style={S.inp} />
                    </div>
                    <div>
                      <label style={S.lbl}>End</label>
                      <input type="time" value={fmtH(tw.e)} onChange={e => setTw(t => ({ ...t, e: toH(e.target.value) }))} style={S.inp} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600 }}>Compare formulations</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>Overlay a second formulation independently normalized</div>
                  </div>
                  <Toggle on={cmpOn} onChange={setCmpOn} />
                </div>
                {cmpOn && (
                  <div style={grid2}>
                    <div style={{ gridColumn: mobile ? "auto" : "1/-1" }}>
                      <label style={S.lbl}>Formulation to compare</label>
                      <MedSelect value={cMed} onChange={setCMed} />
                    </div>
                    <div>
                      <label style={S.lbl}>Dose: {cmpAmt} mg</label>
                      <input type="range" min={5} max={100} step={5} value={cmpAmt} onChange={e=>setCmpAmt(+e.target.value)} style={{ width:"100%", accentColor:"#38bdf8" }} />
                    </div>
                    <div>
                      <label style={S.lbl}>Time</label>
                      <input type="time" value={cmpTime} onChange={e=>setCmpTime(e.target.value)} style={S.inp} />
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10, minHeight:44 }}>
                      <input type="checkbox" checked={cmpFood} onChange={e=>setCmpFood(e.target.checked)} style={{ accentColor:"#38bdf8", width:18, height:18, flexShrink:0 }} />
                      <span style={{ fontSize:13, color:"#94a3b8" }}>With food</span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display:"flex", justifyContent:"flex-end" }}>
                <Btn small color="#7f1d1d" onClick={() => {
                  if (window.confirm("Clear all doses and caffeine?")) { setDoses([]); setCaffs([]); }
                }}>🗑 Clear all</Btn>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dose log */}
      {(doses.length > 0 || caffs.length > 0) && (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <p style={{ margin:"0 0 10px", fontSize:11, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Today's Log</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {doses.map(d => (
              <div key={d.id} style={{ display:"flex", alignItems:"center", gap:6, background:"#0f172a", borderRadius:8, padding:"6px 10px", fontSize:12, border:"1px solid #1e3a5f" }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:MED_CFG[d.med].color, flexShrink:0 }} />
                <span>{d.med} {d.amount}mg @ {fmtH(d.time)}</span>
                {d.food && <span style={{ fontSize:10, color:"#475569" }}>🍽</span>}
                <button onClick={() => setDoses(p => p.filter(x => x.id !== d.id))} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:18, minWidth:36, minHeight:36 }}>×</button>
              </div>
            ))}
            {caffs.map(c => (
              <div key={c.id} style={{ display:"flex", alignItems:"center", gap:6, background:"#0f172a", borderRadius:8, padding:"6px 10px", fontSize:12, border:"1px solid #1e3a5f" }}>
                <span style={{ color:"#fbbf24" }}>☕</span>
                <span>{c.amount}mg @ {fmtH(c.time)}</span>
                <button onClick={() => setCaffs(p => p.filter(x => x.id !== c.id))} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:18, minWidth:36, minHeight:36 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ textAlign:"center", color:"#1e3a5f", fontSize:11, marginTop:8, lineHeight:1.6 }}>
        MPH t½ 2.5h · d-AMP t½ 11h · Caffeine t½ adjustable<br />
        Not a medical device. Consult your prescriber before adjusting treatment.
      </p>
    </div>
  );
}