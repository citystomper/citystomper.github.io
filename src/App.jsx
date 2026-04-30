import { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from "recharts";
import "./App.css";

// ─── PK MATHEMATICS ──────────────────────────────────────────────────────────

function bateman(t, dose, ka, ke) {
  if (t <= 0) return 0;
  if (Math.abs(ka - ke) < 0.001) return dose * ka * t * Math.exp(-ke * t);
  return dose * (ka / (ka - ke)) * (Math.exp(-ke * t) - Math.exp(-ka * t));
}

function pkMPH(t, dose, form, fd = 0) {
  const s = t - fd;
  switch (form) {
    case "Ritalin IR":    return bateman(s, dose, 2.40, 0.278);
    case "Ritalin LA":
    case "Medikinet CR":  return bateman(s, dose*0.5, 2.40, 0.278) + bateman(s-3.5, dose*0.5, 2.40, 0.278);
    case "Concerta": {
      const ir = bateman(s, dose*0.22, 3.0, 0.278);
      let oros = 0;
      for (let i = 0; i <= 7; i++) oros += bateman(s - i*(6.5/7), dose*0.78/8, 5.0, 0.278);
      return ir + oros;
    }
    default: return 0;
  }
}

function pkAMP(t, dose, form, fd = 0) {
  const s = t - fd;
  const ke = 0.0631;
  switch (form) {
    case "Adderall IR": return bateman(s, dose, 1.2, ke);
    case "Adderall XR": return bateman(s, dose*0.5, 1.2, ke) + bateman(s-4, dose*0.5, 1.2, ke);
    case "Vyvanse":
    case "Elvanse":     return bateman(s, dose*0.695, 0.75, ke);
    default: return 0;
  }
}

function pkCaff(t, dose, hl, fd = 0) {
  const s = t - fd;
  if (s <= 0) return 0;
  const ke = Math.LN2 / hl;
  if (s < 0.75) return dose * (s / 0.75);
  return dose * Math.exp(-ke * (s - 0.75));
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MEDS = {
  "Ritalin IR":   { color: "#0088ff", type: "mph" },
  "Ritalin LA":   { color: "#00c0e8", type: "mph" },
  "Medikinet CR": { color: "#00c3d0", type: "mph" },
  "Concerta":     { color: "#6155f5", type: "mph" },
  "Adderall IR":  { color: "#ff8d28", type: "amp" },
  "Adderall XR":  { color: "#ffcc00", type: "amp" },
  "Vyvanse":      { color: "#cb30e0", type: "amp" },
  "Elvanse":      { color: "#ff2d55", type: "amp" },
};

const CAFF_COLOR = "#ac7f5e";
let _uid = 1;
const uid = () => _uid++;

function fmtH(h) {
  const n = ((h % 24) + 24) % 24;
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  return `${hh}:${mm.toString().padStart(2, "0")}`;
}

// ─── ICONS ────────────────────────────────────────────────────────────────────

const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M8.5 1.5v1.5M8.5 14v1.5M1.5 8.5H3M14 8.5h1.5M3.55 3.55l1.06 1.06M12.39 12.39l1.06 1.06M3.55 13.45l1.06-1.06M12.39 4.61l1.06-1.06"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ShareIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <path d="M8.5 1v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M5.5 4L8.5 1l3 3" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 7H3a1 1 0 00-1 1v7a1 1 0 001 1h11a1 1 0 001-1V8a1 1 0 00-1-1h-1"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const PlusIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-time">{fmtH(label)}</div>
      {payload.filter(p => p.value > 0.5).map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          <span className="tooltip-name">{p.name}</span>
          <span className="tooltip-val">{p.value.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── FORM COMPONENTS ─────────────────────────────────────────────────────────

function DoseForm({ value, onChange, onAdd, onCancel }) {
  return (
    <div className="inline-form">
      <select className="f-select" value={value.med}
        onChange={e => onChange({ ...value, med: e.target.value })}>
        {Object.keys(MEDS).map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className="f-row">
        <div className="f-field">
          <label className="f-label">mg</label>
          <input type="number" className="f-input" value={value.amount}
            min={1} max={200} step={1}
            onChange={e => onChange({ ...value, amount: +e.target.value })} />
        </div>
        <div className="f-field">
          <label className="f-label">time</label>
          <input type="number" className="f-input" value={value.time}
            min={0} max={23} step={0.5}
            onChange={e => onChange({ ...value, time: +e.target.value })} />
        </div>
      </div>
      <label className="f-toggle">
        <input type="checkbox" checked={value.food}
          onChange={e => onChange({ ...value, food: e.target.checked })} />
        <span>With food</span>
      </label>
      <div className="f-actions">
        <button className="f-btn-cancel" onClick={onCancel}>Cancel</button>
        <button className="f-btn-add" onClick={onAdd}>Add</button>
      </div>
    </div>
  );
}

function CaffForm({ value, onChange, onAdd, onCancel }) {
  return (
    <div className="inline-form">
      <div className="f-row">
        <div className="f-field">
          <label className="f-label">mg</label>
          <input type="number" className="f-input" value={value.amount}
            min={10} max={600} step={10}
            onChange={e => onChange({ ...value, amount: +e.target.value })} />
        </div>
        <div className="f-field">
          <label className="f-label">time</label>
          <input type="number" className="f-input" value={value.time}
            min={0} max={23} step={0.5}
            onChange={e => onChange({ ...value, time: +e.target.value })} />
        </div>
      </div>
      <label className="f-toggle">
        <input type="checkbox" checked={value.food}
          onChange={e => onChange({ ...value, food: e.target.checked })} />
        <span>With food</span>
      </label>
      <div className="f-actions">
        <button className="f-btn-cancel" onClick={onCancel}>Cancel</button>
        <button className="f-btn-add" onClick={onAdd}>Add</button>
      </div>
    </div>
  );
}

function SettingsForm({ settings, onChange }) {
  const set = (k, v) => onChange({ ...settings, [k]: v });
  return (
    <div className="settings-form">
      <div className="ss-row">
        <span className="ss-label">Target window</span>
        <div className="ss-inputs">
          <input type="number" className="ss-input" value={settings.targetStart}
            min={0} max={23} step={0.5}
            onChange={e => set("targetStart", +e.target.value)} />
          <span className="ss-sep">—</span>
          <input type="number" className="ss-input" value={settings.targetEnd}
            min={1} max={24} step={0.5}
            onChange={e => set("targetEnd", +e.target.value)} />
        </div>
      </div>
      <div className="ss-row">
        <span className="ss-label">Sleep time</span>
        <input type="number" className="ss-input" value={settings.sleepTime}
          min={18} max={30} step={0.5}
          onChange={e => set("sleepTime", +e.target.value)} />
      </div>
      <div className="ss-row">
        <span className="ss-label">Weight (kg)</span>
        <input type="number" className="ss-input" value={settings.weight}
          min={40} max={160} step={1}
          onChange={e => set("weight", +e.target.value)} />
      </div>
      <div className="ss-row ss-row-slider">
        <span className="ss-label">Caffeine t½</span>
        <div className="ss-slider-wrap">
          <input type="range" className="ss-slider" value={settings.caffHL}
            min={2} max={9} step={0.5}
            onChange={e => set("caffHL", +e.target.value)} />
          <span className="ss-slider-val">{settings.caffHL}h</span>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [doses, setDoses]       = useState([]);
  const [caffs, setCaffs]       = useState([]);
  const [compareOn, setCompare] = useState(false);
  const [cmp, setCmp]           = useState({ med: "Ritalin LA", amount: 10, time: 8 });
  const [settings, setSettings] = useState({
    targetStart: 8, targetEnd: 18, sleepTime: 23, caffHL: 5, weight: 75,
  });

  const [adding, setAdding]   = useState(null); // null | 'dose' | 'caff'
  const [newDose, setNewDose] = useState({ med: "Ritalin IR", amount: 10, time: 8, food: false });
  const [newCaff, setNewCaff] = useState({ amount: 100, time: 8, food: false });
  const [selectedDoseId, setSelectedDoseId] = useState(null);

  const [modal, setModal] = useState(null);   // null | 'add' | 'settings'
  const [mTab, setMTab]   = useState("dose");

  // ── Persistence ──────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pk-v2");
      if (raw) {
        const d = JSON.parse(raw);
        if (d.doses)          setDoses(d.doses);
        if (d.caffs)          setCaffs(d.caffs);
        if (d.settings)       setSettings(s => ({ ...s, ...d.settings }));
        if (d.cmp)            setCmp(d.cmp);
        if (d.compareOn != null) setCompare(d.compareOn);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (doses.length === 0) {
      setSelectedDoseId(null);
      return;
    }
    if (!selectedDoseId || !doses.some(d => d.id === selectedDoseId)) {
      setSelectedDoseId(doses[doses.length - 1].id);
    }
  }, [doses, selectedDoseId]);

  useEffect(() => {
    try {
      localStorage.setItem("pk-v2", JSON.stringify({ doses, caffs, settings, cmp, compareOn }));
    } catch {}
  }, [doses, caffs, settings, cmp, compareOn]);

  useEffect(() => {
    try {
      const p = new URLSearchParams(location.search).get("d");
      if (p) {
        const d = JSON.parse(atob(p));
        if (d.doses)          setDoses(d.doses);
        if (d.caffs)          setCaffs(d.caffs);
        if (d.settings)       setSettings(s => ({ ...s, ...d.settings }));
        if (d.cmp)            setCmp(d.cmp);
        if (d.compareOn != null) setCompare(d.compareOn);
      }
    } catch {}
  }, []);

  const share = () => {
    const p = btoa(JSON.stringify({ doses, caffs, settings, cmp, compareOn }));
    navigator.clipboard.writeText(`${location.origin}${location.pathname}?d=${p}`).catch(() => {});
  };

  // ── Chart ─────────────────────────────────────────────────────────────────────
  const { pts, stats, meds } = useMemo(() => {
    const activeMeds = Array.from(new Set(doses.map(d => d.med)));
    const firstDoseByMed = activeMeds.reduce((acc, med) => {
      acc[med] = Math.min(...doses.filter(d => d.med === med).map(d => d.time));
      return acc;
    }, {});
    const firstCaffTime = caffs.length > 0 ? Math.min(...caffs.map(c => c.time)) : null;
    const raw = [];
    for (let t = 0; t <= 24; t += 0.1) {
      let mph = 0, amp = 0, caff = 0, cmpV = 0;
      const medVals = {};
      for (const med of activeMeds) medVals[med] = 0;
      for (const d of doses) {
        const cfg = MEDS[d.med];
        if (!cfg) continue;
        const fd = d.food ? (cfg.type === "amp" ? 1.0 : 0.75) : 0;
        if (cfg.type === "mph") {
          const val = pkMPH(t - d.time, d.amount, d.med, fd);
          mph += val;
          medVals[d.med] += val;
        }
        if (cfg.type === "amp") {
          const val = pkAMP(t - d.time, d.amount, d.med, fd);
          amp += val;
          medVals[d.med] += val;
        }
      }
      for (const c of caffs) caff += pkCaff(t - c.time, c.amount, settings.caffHL, c.food ? 0.5 : 0);
      if (compareOn) {
        const cfg = MEDS[cmp.med];
        if (cfg?.type === "mph") cmpV = pkMPH(t - cmp.time, cmp.amount, cmp.med, 0);
        if (cfg?.type === "amp") cmpV = pkAMP(t - cmp.time, cmp.amount, cmp.med, 0);
      }
      raw.push({ t: +t.toFixed(1), mph, amp, caff, cmp: cmpV, ...medVals });
    }

    const pMPH  = Math.max(...raw.map(p => p.mph),  0.001);
    const pAMP  = Math.max(...raw.map(p => p.amp),  0.001);
    const pCaff = Math.max(...raw.map(p => p.caff), 0.001);
    const pCmp  = Math.max(...raw.map(p => p.cmp),  0.001);
    const medPeaks = activeMeds.reduce((acc, med) => {
      acc[med] = Math.max(...raw.map(p => p[med] || 0), 0.001);
      return acc;
    }, {});

    const hasMPH  = doses.some(d => MEDS[d.med]?.type === "mph");
    const hasAMP  = doses.some(d => MEDS[d.med]?.type === "amp");
    const hasCaff = caffs.length > 0;

    let sleepOk = null;
    for (const p of raw) {
      if (p.t < 10) continue;
      const ok =
        (!hasMPH  || p.mph  < pMPH  * 0.18) &&
        (!hasAMP  || p.amp  < pAMP  * 0.15) &&
        (!hasCaff || p.caff < settings.weight * 0.6);
      if (ok) { sleepOk = p.t; break; }
    }

    const maxBy = key => raw.reduce((best, p) => p[key] > best[key] ? p : best, raw[0]);

    return {
      pts: raw.map(p => ({
        t:    p.t,
        ...activeMeds.reduce((acc, med) => {
          acc[med] = p.t < firstDoseByMed[med]
            ? null
            : +(p[med] / medPeaks[med] * 100).toFixed(1);
          return acc;
        }, {}),
        caff: firstCaffTime !== null && p.t < firstCaffTime
          ? null
          : +(p.caff / pCaff * 100).toFixed(1),
        cmp:  compareOn
          ? (p.t < cmp.time ? null : +(p.cmp / pCmp * 100).toFixed(1))
          : undefined,
      })),
      stats: {
        sleepOk, hasMPH, hasAMP, hasCaff,
        peakMPH: maxBy("mph"), peakAMP: maxBy("amp"), peakCaff: maxBy("caff"),
      },
      meds: activeMeds,
    };
  }, [doses, caffs, settings, compareOn, cmp]);

  const hasAny = stats.hasMPH || stats.hasAMP || stats.hasCaff;
  const selectedDose = doses.find(d => d.id === selectedDoseId) || null;

  const addDose = () => { setDoses(d => [...d, { ...newDose, id: uid() }]); setAdding(null); };
  const addCaff = () => { setCaffs(c => [...c, { ...newCaff, id: uid() }]); setAdding(null); };
  const toggleAdding = type => setAdding(a => a === type ? null : type);

  return (
    <>
      <svg style={{ display: "none" }} aria-hidden="true">
        <defs>
          <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008"
              numOctaves="2" seed="92" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
            <feDisplacementMap in="SourceGraphic" in2="blurred" scale="55"
              xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <div className="bg" aria-hidden="true">
        <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
      </div>

      <div className="layout">

        {/* ══ SIDEBAR (desktop only) ══════════════════════════════════════ */}
        <aside className="sidebar glass">
          <div className="sb-hdr">
            <div>
              <h1 className="sb-title">PK Timeline</h1>
              <p className="sb-sub">Pharmacokinetics</p>
            </div>
            <div className="sb-hdr-btns">
              <button className="icon-btn" onClick={share} title="Copy share link"><ShareIcon /></button>
              <button className="icon-btn" title="Settings"
                onClick={() => document.getElementById("sb-settings")?.scrollIntoView({ behavior: "smooth" })}>
                <GearIcon />
              </button>
            </div>
          </div>

          <div className="sb-body">

            {/* Doses */}
            <div className="sb-section">
              <div className="sb-section-hdr">
                <span className="sb-lbl">Doses</span>
                <button className={`sb-plus${adding === "dose" ? " active" : ""}`}
                  onClick={() => toggleAdding("dose")}>
                  <PlusIcon size={13} />
                </button>
              </div>
              {adding === "dose" && (
                <DoseForm value={newDose} onChange={setNewDose}
                  onAdd={addDose} onCancel={() => setAdding(null)} />
              )}
              {doses.length === 0 && adding !== "dose" && (
                <p className="sb-empty">No doses — tap + to add</p>
              )}
              {doses.map(d => (
                <div key={d.id}
                  className={`sb-row${selectedDoseId === d.id ? " sb-row-selected" : ""}`}
                  onClick={() => setSelectedDoseId(d.id)}>
                  <span className="sb-dot" style={{ background: MEDS[d.med]?.color }} />
                  <div className="sb-row-info">
                    <span className="sb-row-name">{d.med}</span>
                    <span className="sb-row-meta">{d.amount}mg · {fmtH(d.time)}{d.food ? " · food" : ""}</span>
                  </div>
                  <button className="sb-del"
                    onClick={e => { e.stopPropagation(); setDoses(p => p.filter(x => x.id !== d.id)); }}
                    >×</button>
                </div>
              ))}
            </div>

            {/* Caffeine */}
            <div className="sb-section">
              <div className="sb-section-hdr">
                <span className="sb-lbl">Caffeine</span>
                <button className={`sb-plus${adding === "caff" ? " active" : ""}`}
                  onClick={() => toggleAdding("caff")}>
                  <PlusIcon size={13} />
                </button>
              </div>
              {adding === "caff" && (
                <CaffForm value={newCaff} onChange={setNewCaff}
                  onAdd={addCaff} onCancel={() => setAdding(null)} />
              )}
              {caffs.length === 0 && adding !== "caff" && (
                <p className="sb-empty">No caffeine — tap + to add</p>
              )}
              {caffs.map(c => (
                <div key={c.id} className="sb-row">
                  <span className="sb-dot" style={{ background: CAFF_COLOR }} />
                  <div className="sb-row-info">
                    <span className="sb-row-name">Caffeine</span>
                    <span className="sb-row-meta">{c.amount}mg · {fmtH(c.time)}{c.food ? " · food" : ""}</span>
                  </div>
                  <button className="sb-del"
                    onClick={() => setCaffs(p => p.filter(x => x.id !== c.id))}>×</button>
                </div>
              ))}
            </div>

            {/* Compare */}
            <div className="sb-section">
              <div className="sb-section-hdr">
                <span className="sb-lbl">Compare</span>
                <label className="sb-toggle">
                  <input type="checkbox" checked={compareOn}
                    onChange={e => setCompare(e.target.checked)} />
                  <span className="sb-track" />
                </label>
              </div>
              {compareOn && (
                <div className="inline-form">
                  <select className="f-select" value={cmp.med}
                    onChange={e => setCmp(c => ({ ...c, med: e.target.value }))}>
                    {Object.keys(MEDS).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div className="f-row">
                    <div className="f-field">
                      <label className="f-label">mg</label>
                      <input type="number" className="f-input" value={cmp.amount}
                        min={1} max={200} step={1}
                        onChange={e => setCmp(c => ({ ...c, amount: +e.target.value }))} />
                    </div>
                    <div className="f-field">
                      <label className="f-label">time</label>
                      <input type="number" className="f-input" value={cmp.time}
                        min={0} max={23} step={0.5}
                        onChange={e => setCmp(c => ({ ...c, time: +e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Settings */}
            <div className="sb-section" id="sb-settings">
              <div className="sb-section-hdr">
                <span className="sb-lbl">Settings</span>
              </div>
              <SettingsForm settings={settings} onChange={setSettings} />
            </div>

          </div>
        </aside>

        {/* ══ MAIN CONTENT ════════════════════════════════════════════════ */}
        <main className="main">

          {/* Mobile header */}
          <div className="mobile-hdr">
            <h1 className="mobile-title">Pharmacokinetics</h1>
            <div className="mobile-hdr-btns">
              <button className="circle-btn glass" onClick={share}><ShareIcon /></button>
              <button className="circle-btn glass" onClick={() => setModal("settings")}><GearIcon /></button>
            </div>
          </div>

          {/* Chart hero */}
          <div className="glass chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pts} margin={{ top: 12, right: 18, bottom: 4, left: 2 }}>
                <CartesianGrid strokeDasharray="0" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="t" type="number" domain={[0, 24]}
                  ticks={[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]}
                  tickFormatter={v => `${v}:00`}
                  tick={{ fontSize: 11, fill: "var(--chart-tick)", fontFamily: "var(--font)" }}
                  axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 11, fill: "var(--chart-tick)", fontFamily: "var(--font)" }}
                  axisLine={false} tickLine={false} width={36} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceArea x1={settings.targetStart} x2={settings.targetEnd}
                  fill="rgba(52, 199, 89, 0.08)" stroke="rgba(52, 199, 89, 0.22)"
                  strokeDasharray="3 3" />
                <ReferenceLine x={settings.sleepTime}
                  stroke="var(--chart-ref)" strokeDasharray="3 3"
                  label={{ value: "sleep", position: "insideTopRight",
                    offset: 6, fontSize: 10, fill: "var(--chart-tick)" }} />
                {doses.map(d => (
                  <ReferenceLine key={d.id} x={d.time}
                    stroke={MEDS[d.med]?.color} strokeOpacity={0.22} strokeDasharray="3 3" />
                ))}
                {caffs.map(c => (
                  <ReferenceLine key={c.id} x={c.time}
                    stroke={CAFF_COLOR} strokeOpacity={0.22} strokeDasharray="3 3" />
                ))}
                {meds.map(med => (
                  <Line key={med} type="monotone" dataKey={med} name={med}
                    stroke={MEDS[med]?.color} strokeWidth={2} dot={false} connectNulls={false} />
                ))}
                {stats.hasCaff && <Line type="monotone" dataKey="caff" name="Caffeine"
                  stroke={CAFF_COLOR} strokeWidth={2} dot={false} connectNulls={false} />}
                {compareOn && (
                  <Line type="monotone" dataKey="cmp" name="Compare"
                    stroke={MEDS[cmp.med]?.color || "var(--system-gray2)"} strokeWidth={1.5}
                    strokeDasharray="6 4" dot={false} connectNulls={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
            {!hasAny && (
              <div className="chart-empty">
                <p className="chart-empty-hint">Add a dose to see the PK curve</p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="stats-row">
            <div className="glass-thin stat-card">
              <div className="stat-label">Sleep clearance</div>
              <div className="stat-value"
                style={{ color: stats.sleepOk !== null && stats.sleepOk <= settings.sleepTime
                  ? "var(--green)" : "var(--c1)" }}>
                {stats.sleepOk !== null ? fmtH(stats.sleepOk) : hasAny ? ">24:00" : "—"}
              </div>
            </div>
            <div className="glass-thin stat-card">
              <div className="stat-label">Target window</div>
              <div className="stat-value">{fmtH(settings.targetStart)} — {fmtH(settings.targetEnd)}</div>
            </div>
            <div className="glass-thin stat-card dose-card">
              <div className="stat-label">Selected dose</div>
              {selectedDose ? (
                <>
                  <div className="dose-title" style={{ color: MEDS[selectedDose.med]?.color }}>
                    {selectedDose.med}
                  </div>
                  <div className="dose-meta">
                    {selectedDose.amount}mg · {fmtH(selectedDose.time)} · {selectedDose.food ? "with food" : "fasted"}
                  </div>
                </>
              ) : (
                <div className="dose-empty">No dose selected</div>
              )}
            </div>
            {stats.hasMPH && (
              <div className="glass-thin stat-card">
                <div className="stat-label">MPH peak</div>
                <div className="stat-value" style={{ color: "var(--system-blue)" }}>{fmtH(stats.peakMPH.t)}</div>
              </div>
            )}
            {stats.hasAMP && (
              <div className="glass-thin stat-card">
                <div className="stat-label">AMP peak</div>
                <div className="stat-value" style={{ color: "var(--system-orange)" }}>{fmtH(stats.peakAMP.t)}</div>
              </div>
            )}
            {stats.hasCaff && (
              <div className="glass-thin stat-card">
                <div className="stat-label">Caffeine peak</div>
                <div className="stat-value" style={{ color: CAFF_COLOR }}>{fmtH(stats.peakCaff.t)}</div>
              </div>
            )}
            <div className="glass-thin stat-card">
              <div className="stat-label">Active doses</div>
              <div className="stat-value">{doses.length + caffs.length}</div>
            </div>
          </div>

          {/* Mobile dose list */}
          {(doses.length > 0 || caffs.length > 0) && (
            <div className="glass mobile-list">
              {doses.map(d => (
                <div key={d.id}
                  className={`sb-row${selectedDoseId === d.id ? " sb-row-selected" : ""}`}
                  onClick={() => setSelectedDoseId(d.id)}>
                  <span className="sb-dot" style={{ background: MEDS[d.med]?.color }} />
                  <div className="sb-row-info">
                    <span className="sb-row-name">{d.med}</span>
                    <span className="sb-row-meta">{d.amount}mg · {fmtH(d.time)}{d.food ? " · food" : ""}</span>
                  </div>
                  <button className="sb-del"
                    onClick={e => { e.stopPropagation(); setDoses(p => p.filter(x => x.id !== d.id)); }}
                    >×</button>
                </div>
              ))}
              {caffs.map(c => (
                <div key={c.id} className="sb-row">
                  <span className="sb-dot" style={{ background: CAFF_COLOR }} />
                  <div className="sb-row-info">
                    <span className="sb-row-name">Caffeine</span>
                    <span className="sb-row-meta">{c.amount}mg · {fmtH(c.time)}{c.food ? " · food" : ""}</span>
                  </div>
                  <button className="sb-del"
                    onClick={() => setCaffs(p => p.filter(x => x.id !== c.id))}>×</button>
                </div>
              ))}
            </div>
          )}

          <p className="disclaimer">Not a medical device. Consult your prescriber before adjusting treatment.</p>

        </main>
      </div>

      {/* ══ MOBILE FAB ══════════════════════════════════════════════════════ */}
      <button className="fab" onClick={() => { setModal("add"); setMTab("dose"); }}
        aria-label="Add dose">
        <PlusIcon size={24} />
      </button>

      {/* ══ MOBILE MODAL ════════════════════════════════════════════════════ */}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-sheet glass" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />

            {modal === "add" && (
              <>
                <div className="modal-seg">
                  {["dose", "caffeine", "compare"].map(t => (
                    <button key={t} className={`seg-btn${mTab === t ? " seg-active" : ""}`}
                      onClick={() => setMTab(t)}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {mTab === "dose" && (
                  <>
                    <DoseForm value={newDose} onChange={setNewDose}
                      onAdd={() => setDoses(d => [...d, { ...newDose, id: uid() }])}
                      onCancel={() => setModal(null)} />
                    {doses.length > 0 && (
                      <button className="modal-clear-btn" onClick={() => setDoses([])}>
                        Clear all doses
                      </button>
                    )}
                  </>
                )}

                {mTab === "caffeine" && (
                  <>
                    <CaffForm value={newCaff} onChange={setNewCaff}
                      onAdd={() => setCaffs(c => [...c, { ...newCaff, id: uid() }])}
                      onCancel={() => setModal(null)} />
                    {caffs.length > 0 && (
                      <button className="modal-clear-btn" onClick={() => setCaffs([])}>
                        Clear all caffeine
                      </button>
                    )}
                  </>
                )}

                {mTab === "compare" && (
                  <div className="inline-form">
                    <label className="f-toggle">
                      <input type="checkbox" checked={compareOn}
                        onChange={e => setCompare(e.target.checked)} />
                      <span>Enable comparison curve</span>
                    </label>
                    {compareOn && (
                      <>
                        <select className="f-select" value={cmp.med}
                          onChange={e => setCmp(c => ({ ...c, med: e.target.value }))}>
                          {Object.keys(MEDS).map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <div className="f-row">
                          <div className="f-field">
                            <label className="f-label">mg</label>
                            <input type="number" className="f-input" value={cmp.amount}
                              min={1} max={200} step={1}
                              onChange={e => setCmp(c => ({ ...c, amount: +e.target.value }))} />
                          </div>
                          <div className="f-field">
                            <label className="f-label">time</label>
                            <input type="number" className="f-input" value={cmp.time}
                              min={0} max={23} step={0.5}
                              onChange={e => setCmp(c => ({ ...c, time: +e.target.value }))} />
                          </div>
                        </div>
                      </>
                    )}
                    <button className="f-btn-add" onClick={() => setModal(null)}>Done</button>
                  </div>
                )}
              </>
            )}

            {modal === "settings" && (
              <>
                <h2 className="modal-title">Settings</h2>
                <SettingsForm settings={settings} onChange={setSettings} />
                <button className="f-btn-add" onClick={() => setModal(null)}>Done</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
