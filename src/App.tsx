import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import logo from "../Acc_Logo_White_Purple_RGB.png";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Truck,
  Clock,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Target,
  Users,
  Settings,
  RefreshCw,
  PlayCircle,
  Database,
  MapPin,
  CircleDot,
  ChevronRight,
  MonitorSmartphone,
  Info as InfoIcon,
  HelpCircle,
  Wand2,
  PauseCircle,
  ClipboardCopy,
  Filter,
} from "lucide-react";

/**
 * Best Buy – Delivery Promise & Capacity Orchestrator (MLP++)
 * Single-file React app for GPT Canvas. Fully synthetic, zero backends.
 * Theme: monochrome gray, executive-polished. Tailwind + Recharts + Framer Motion + Lucide.
 * NEW: Every tile is interactive + self-explanatory with tooltips, modals, tour, and story mode.
 *
 * NOTE (dev): A small self-test suite runs on mount (console.assert) to catch regressions.
 */

/*********************** Synthetic Data ************************/ 
const seed = (n: number) => {
  let t = n % 2147483647;
  return () => (t = (t * 48271) % 2147483647) / 2147483647;
};
const rng = seed(42);

type Node = {
  id: string;
  city: string;
  type: "MEC" | "RDC" | "STORE";
  baseCapacityPerH: number; // orders/hour
  baseDemandPerH: number; // orders/hour
};

type Carrier = {
  name: string;
  baseOTP: number; // on-time prob
  baseCost: number; // $ per order
  baseDailyCap: number; // orders/day
};

const BASE_NODES: Node[] = [
  { id: "MEC-1 Chicago", city: "Chicago, IL", type: "MEC", baseCapacityPerH: 820, baseDemandPerH: 640 },
  { id: "RDC-East Columbus", city: "Columbus, OH", type: "RDC", baseCapacityPerH: 1200, baseDemandPerH: 910 },
  { id: "Store-102 Lincoln Park", city: "Chicago, IL", type: "STORE", baseCapacityPerH: 110, baseDemandPerH: 85 },
  { id: "MEC-2 Newark", city: "Newark, NJ", type: "MEC", baseCapacityPerH: 930, baseDemandPerH: 720 },
];

const BASE_CARRIERS: Carrier[] = [
  { name: "UPS", baseOTP: 0.95, baseCost: 7.1, baseDailyCap: 5200 },
  { name: "FedEx", baseOTP: 0.94, baseCost: 7.4, baseDailyCap: 5000 },
  { name: "UberDirect", baseOTP: 0.91, baseCost: 9.6, baseDailyCap: 1300 },
  { name: "DoorDash", baseOTP: 0.90, baseCost: 9.2, baseDailyCap: 1200 },
];

/*********************** Utility ************************/ 
function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, digits = 1) { return `${(n * 100).toFixed(digits)}%`; }
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function ts() { const now = new Date(); const hh = String(now.getHours()).padStart(2, "0"); const mm = String(now.getMinutes()).padStart(2, "0"); return `${hh}:${mm}`; }

const INITIAL_EVENTS: { t: string; who: string; text: string }[] = [
  { t: "09:00", who: "SenseAgent", text: "Ingested 8 weeks history + live slots. Surge = 35%; WeatherIdx = 0.20." },
];

/*********************** Model & Simulation ************************/ 

type Policy = "Aggressive" | "Balanced" | "Reliable";

interface Settings {
  surgePct: number; // 0..1 additional demand
  weatherIdx: number; // 0..1 (higher = worse)
  plusMix: number; // 0..1 proportion of member orders
  policy: Policy;
  upsDrop: number; // -0.5..0.5 (e.g., -0.1 = 10% capacity drop)
  fedexDrop: number;
  crowdBoost: number; // 0..0.5 capacity boost for crowd carriers
  reserveForMembers: boolean; // prioritize plus/total in promise windows
  loadBalanceToNewark: number; // 0..0.5 shift from Chicago to Newark
}

interface KPIs {
  hourly: { hour: number; demand: number; capacity: number; otd: number }[];
  dailyOrders: number;
  otd: number; // overall on-time delivery rate against promised windows
  lateRate: number;
  lateAvoidedUSD: number;
  convRate: number; // checkout conversion
  convLiftPts: number; // +/- percentage points vs baseline 2.4%
  costPerOrder: number;
}

const BASELINE_CONV = 0.024; // 2.4%
const LATE_COST = 8.0; // appeasement/avoid cost per late

function computeKPIs(settings: Settings, nodes = BASE_NODES, carriers = BASE_CARRIERS): KPIs {
  const hours = Array.from({ length: 10 }, (_, i) => i);

  // Effective carrier capacity and OTP
  const upsCap = carriers[0].baseDailyCap * (1 + settings.upsDrop);
  const fedexCap = carriers[1].baseDailyCap * (1 + settings.fedexDrop);
  const crowdCap = (carriers[2].baseDailyCap + carriers[3].baseDailyCap) * (1 + settings.crowdBoost);
  const totalCarrierCap = Math.max(1, upsCap + fedexCap + crowdCap);
  const carrierOTP =
    (carriers[0].baseOTP * upsCap + carriers[1].baseOTP * fedexCap + (carriers[2].baseOTP + carriers[3].baseOTP) * (crowdCap / 2)) /
    totalCarrierCap;

  let dailyOrders = 0; let dailyCapacity = 0;
  const hourly = hours.map((h) => {
    const todBump = 0.85 + 0.35 * Math.sin((Math.PI * (h + 2)) / 10);
    const demand = nodes.reduce((sum, n) => sum + n.baseDemandPerH, 0) * (1 + settings.surgePct) * todBump;
    const capacityRaw = nodes.reduce((sum, n) => sum + n.baseCapacityPerH, 0) * todBump;
    const shift = settings.loadBalanceToNewark * 0.25 * nodes[0].baseDemandPerH * (1 + settings.surgePct) * todBump; // simple proxy
    const capacity = capacityRaw;
    const demandFinal = demand - shift; // Chicago relief (net same)
    dailyOrders += demandFinal; dailyCapacity += capacity;
    const service = clamp(capacity / (demandFinal || 1), 0, 1);
    return { hour: h, demand: demandFinal, capacity: capacity, otd: service };
  });

  let serviceQuality = hourly.reduce((s, x) => s + x.otd * x.demand, 0) / Math.max(1, dailyOrders);

  const policyAdj = settings.policy === "Aggressive" ? -0.05 : settings.policy === "Reliable" ? 0.04 : 0.0;
  const weatherPenalty = -0.12 * settings.weatherIdx; // bad weather reduces OTD
  const memberReserveBoost = settings.reserveForMembers ? 0.02 + 0.01 * settings.plusMix : 0.0;

  const otd = clamp(serviceQuality + policyAdj + weatherPenalty, 0, 1) * carrierOTP + memberReserveBoost;
  const finalOtd = clamp(otd, 0, 1);
  const lateRate = 1 - finalOtd;

  const convLift =
    (settings.policy === "Aggressive" ? 0.003 : settings.policy === "Balanced" ? 0.001 : -0.001) +
    (finalOtd - 0.9) * 0.5; // reliable promise reduces friction
  const convRate = clamp(BASELINE_CONV + convLift, 0.01, 0.06);

  const baseCPO = 7.6; // blended
  const costPerOrder = baseCPO + settings.crowdBoost * 0.9 + (settings.upsDrop < 0 ? 0.15 : 0) + (settings.fedexDrop < 0 ? 0.15 : 0);

  const baselineLate = 0.12; // naive during surge
  const lateAvoidedUSD = clamp(baselineLate - lateRate, -0.2, 0.2) * dailyOrders * LATE_COST;

  return { hourly, dailyOrders, otd: finalOtd, lateRate, lateAvoidedUSD, convRate, convLiftPts: (convRate - BASELINE_CONV) * 100, costPerOrder };
}

/*********************** Agent Brain ************************/ 
function proposeAgentActions(kpi: KPIs, s: Settings) {
  const actions: { id: string; title: string; detail: string; impact: string; apply: (s: Settings) => Settings }[] = [];
  if (kpi.otd < 0.95) {
    actions.push({ id: "tighten-promise", title: "Tighten promise for non‑members by +1 day in risk ZIPs", detail: "Shift to Reliable policy; reserve capacity for Plus/Total to stabilize ETA", impact: "+2–4 pts OTD; −0.1 pt conversion", apply: (s) => ({ ...s, policy: "Reliable", reserveForMembers: true }) });
  }
  if (s.surgePct > 0.25) {
    actions.push({ id: "rebalance-nodes", title: "Rebalance 20% of MEC‑1 (Chicago) volume to MEC‑2 (Newark)", detail: "Pre-allocate next 3 waves to Newark where cutoffs are healthier", impact: "+1–2 pts OTD in Midwest; reduces late fees", apply: (s) => ({ ...s, loadBalanceToNewark: clamp(s.loadBalanceToNewark + 0.2, 0, 0.5) }) });
  }
  if (s.upsDrop < -0.05 || s.fedexDrop < -0.05) {
    actions.push({ id: "boost-crowd", title: "Add 15% capacity via UberDirect/DoorDash for same‑day ZIPs", detail: "Temporal burst capacity on short-haul lanes while parcel recovers", impact: "+1–2 pts OTD; +$0.10 CPO", apply: (s) => ({ ...s, crowdBoost: clamp(s.crowdBoost + 0.15, 0, 0.5) }) });
  }
  if (kpi.otd >= 0.97) {
    actions.push({ id: "optimize-cost", title: "Relax to Balanced policy after peak wave", detail: "Recover conversion with minimal service risk", impact: "+0.1–0.2 pt conversion; service stable", apply: (s) => ({ ...s, policy: "Balanced" }) });
  }
  return actions;
}

/*********************** UI Primitives ************************/ 
function Tooltip({ text }: { text: string }) {
  return (
    <span className="ml-1 inline-flex items-center" title={text}>
      <InfoIcon className="h-3.5 w-3.5 text-gray-400" />
    </span>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-gray-100">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>
        <div className="mt-3 text-sm text-gray-300">{children}</div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-900/60 px-2 py-0.5 text-xs text-gray-300">{children}</span>;
}

/*********************** Interactive Tiles ************************/ 
function Metric({ label, value, sub, onClick, help }: { label: string; value: string; sub?: string; onClick?: () => void; help?: string }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-gray-900/70 border border-gray-800 p-4 shadow-inner text-left hover:border-gray-600 transition">
      <div className="text-xs uppercase tracking-wider text-gray-400 flex items-center">{label} {help && <Tooltip text={help} />}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-100">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </button>
  );
}

function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, help }: any) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-gray-300">
        <span className="flex items-center gap-1">{label} {help && <Tooltip text={help} />}</span>
        <span className="tabular-nums text-gray-400">{(value * 100).toFixed(0)}%</span>
      </div>
      <input className="w-full h-2 rounded bg-gray-800 appearance-none cursor-pointer" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <button onClick={() => onChange(!checked)} className={`flex items-center justify-between w-full rounded-xl border p-3 ${checked ? "bg-gray-700/60 border-gray-600" : "bg-gray-900/60 border-gray-800"}`}>
      <span className="text-sm text-gray-300 flex items-center gap-1">{label} {help && <Tooltip text={help} />}</span>
      <span className={`inline-flex h-6 w-11 items-center rounded-full transition ${checked ? "bg-gray-300" : "bg-gray-700"}`}>
        <span className={`h-5 w-5 rounded-full bg-gray-950 transform transition ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </span>
    </button>
  );
}

function NodeCard({ name, city, util, onClick }: { name: string; city: string; util: number; onClick: () => void }) {
  const color = util > 0.95 ? "bg-red-500/80" : util > 0.85 ? "bg-yellow-500/80" : "bg-emerald-500/80";
  const badge = util > 0.95 ? <AlertTriangle className="h-4 w-4" /> : util > 0.85 ? <Clock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />;
  return (
    <button onClick={onClick} className="text-left rounded-2xl border border-gray-800 bg-gray-900/70 p-4 hover:border-gray-600 transition">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-gray-200 font-medium">{name}</div>
          <div className="text-xs text-gray-500 flex items-center gap-1"><MapPin className="h-3 w-3" />{city}</div>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-950 ${color}`}>{badge}<span className="ml-1">{pct(util)}</span></div>
      </div>
      <div className="mt-3 h-2 w-full bg-gray-800 rounded">
        <div className="h-2 rounded bg-gray-400" style={{ width: `${clamp(util, 0, 1) * 100}%` }} />
      </div>
      <div className="mt-2 text-xs text-gray-500">Click for node details & levers</div>
    </button>
  );
}

function ChartPanel({ data, baseline, label, type = "area", onTypeCycle }: { data: any[]; baseline?: any[]; label: string; type?: "area" | "bar" | "line"; onTypeCycle?: () => void }) {
  return (
    <div className="flex h-56 flex-col rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-gray-300 flex items-center gap-2">
          {label}
          <Tooltip text="Click chart footer to cycle visualization. Toggle baseline compare." />
        </div>
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {type === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="x" stroke="#6b7280" tick={{ fontSize: 12 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
              <RTooltip contentStyle={{ background: "#0b0f19", border: "1px solid #1f2937", color: "#e5e7eb" }} />
              <Area type="monotone" dataKey="y" stroke="#9ca3af" fill="#6b7280" fillOpacity={0.3} />
              {baseline && <Line type="monotone" dataKey="y" data={baseline} stroke="#9ca3af" strokeDasharray="4 4" dot={false} />}
            </AreaChart>
          ) : type === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="x" stroke="#6b7280" tick={{ fontSize: 12 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
              <RTooltip contentStyle={{ background: "#0b0f19", border: "1px solid #1f2937", color: "#e5e7eb" }} />
              <Bar dataKey="y" stroke="#9ca3af" fill="#6b7280" />
              {baseline && <Line type="monotone" dataKey="y" data={baseline} stroke="#9ca3af" strokeDasharray="4 4" dot={false} />}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="x" stroke="#6b7280" tick={{ fontSize: 12 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
              <RTooltip contentStyle={{ background: "#0b0f19", border: "1px solid #1f2937", color: "#e5e7eb" }} />
              <Line type="monotone" dataKey="y" stroke="#9ca3af" dot={false} />
              {baseline && <Line type="monotone" dataKey="y" data={baseline} stroke="#9ca3af" strokeDasharray="4 4" dot={false} />}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <button className="text-xs text-gray-400 underline decoration-dotted" onClick={onTypeCycle}>Cycle chart type</button>
        <div className="text-[10px] leading-4 text-gray-500 text-right">
          <div>Hover for details</div>
          <div>Dashed = baseline</div>
        </div>
      </div>
    </div>
  );
}

function OrchestrationFlow({ states, onPick }: { states: { id: string; label: string; active: boolean; note?: string }[]; onPick: (id: string) => void; }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <div className="text-sm text-gray-300 mb-3 flex items-center gap-2">Agent Orchestration <Tooltip text="Sense → Forecast → Decide → Act. Click a stage to inspect." /></div>
      <div className="grid grid-cols-4 gap-3">
        {states.map((s) => (
          <button key={s.id} onClick={() => onPick(s.id)} className={`text-left rounded-xl border ${s.active ? "border-gray-600" : "border-gray-800"} bg-gray-950 p-3 hover:border-gray-600 transition`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-200">
                <CircleDot className={`h-3 w-3 ${s.active ? "text-gray-200" : "text-gray-600"}`} />
                <div className="text-sm font-medium">{s.label}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </div>
            {s.note && <div className="mt-2 text-xs text-gray-500">{s.note}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentStream({ events, filter }: { events: { t: string; who: string; text: string }[]; filter: "All" | "Agent" | "System" }) {
  const filtered = events.filter(e => filter === "All" ? true : filter === "Agent" ? e.who.includes("Agent") : e.who === "System" || e.who === "Orchestrator");
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 h-[22rem] overflow-auto">
      <div className="text-sm text-gray-300 mb-3 flex items-center gap-2"><Activity className="h-4 w-4"/> Agent Activity Stream
        <Tooltip text="Live commentary of what the agents are sensing, deciding, and doing." /></div>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Pill><Filter className="h-3 w-3 mr-1"/>Filter: {filter}</Pill>
      </div>
      <div className="space-y-2">
        {filtered.map((e, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-gray-800 bg-gray-950 p-3">
            <div className="text-xs text-gray-500">{e.t} • {e.who}</div>
            <div className="text-sm text-gray-200 mt-1">{e.text}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/*********************** Self Tests (console.assert) ************************/ 
function runSelfTests() {
  const base: Settings = { surgePct: 0.2, weatherIdx: 0, plusMix: 0.3, policy: "Balanced", upsDrop: 0, fedexDrop: 0, crowdBoost: 0, reserveForMembers: false, loadBalanceToNewark: 0 };
  const k0 = computeKPIs(base);
  console.assert(k0.otd >= 0 && k0.otd <= 1, "OTD in [0,1]");
  console.assert(k0.convRate >= 0.01 && k0.convRate <= 0.06, "Conversion in [1%,6%]");

  const kAgg = computeKPIs({ ...base, policy: "Aggressive" });
  const kRel = computeKPIs({ ...base, policy: "Reliable" });
  console.assert(kAgg.otd <= k0.otd + 1e-6, "Aggressive should not improve OTD vs Balanced");
  console.assert(kRel.otd >= k0.otd - 1e-6, "Reliable should not degrade OTD vs Balanced");

  const kSurge = computeKPIs({ ...base, surgePct: 0.5 });
  console.assert(kSurge.otd <= k0.otd + 0.05, "Higher surge should not increase OTD materially");

  const kCrowd = computeKPIs({ ...base, crowdBoost: 0.2 });
  console.assert(kCrowd.costPerOrder > k0.costPerOrder, "Crowd boost should increase $/order");

  const risky = computeKPIs({ ...base, surgePct: 0.6, upsDrop: -0.2 });
  const actions = proposeAgentActions(risky, { ...base, surgePct: 0.6, upsDrop: -0.2 });
  console.assert(actions.length > 0, "Risky scenario should produce agent actions");
  // eslint-disable-next-line no-console
  console.log("Self-tests passed ✅", { k0, kAgg, kRel, kSurge, kCrowd, risky, actions });
}

/*********************** Main App ************************/ 
export default function App() {
  const [view, setView] = useState<"landing" | "app">("landing");
  const [settings, setSettings] = useState<Settings>({ surgePct: 0.35, weatherIdx: 0.2, plusMix: 0.4, policy: "Balanced", upsDrop: -0.08, fedexDrop: 0.0, crowdBoost: 0.1, reserveForMembers: true, loadBalanceToNewark: 0.0 });
  const [baseline] = useState(() => computeKPIs({ ...settings, policy: "Balanced", upsDrop: 0, fedexDrop: 0, crowdBoost: 0, reserveForMembers: false }));
  const kpi = useMemo(() => computeKPIs(settings), [settings]);
  const actions = useMemo(() => proposeAgentActions(kpi, settings), [kpi, settings]);

  useEffect(() => { runSelfTests(); }, []);

  // For charts
  const capacitySeries = kpi.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.capacity) }));
  const demandSeries = kpi.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.demand) }));
  const otdSeries = kpi.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.otd * 100) }));
  const baseCap = baseline.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.capacity) }));
  const baseDem = baseline.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.demand) }));
  const baseOtd = baseline.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.otd * 100) }));

  // Node utils (simple proxy)
  const utilChicago = clamp((BASE_NODES[0].baseDemandPerH * (1 + settings.surgePct)) / (BASE_NODES[0].baseCapacityPerH || 1), 0, 1);
  const utilColumbus = clamp((BASE_NODES[1].baseDemandPerH * (1 + settings.surgePct)) / (BASE_NODES[1].baseCapacityPerH || 1), 0, 1);
  const utilStore = clamp((BASE_NODES[2].baseDemandPerH * (1 + settings.surgePct)) / (BASE_NODES[2].baseCapacityPerH || 1), 0, 1);
  const utilNewark = clamp((BASE_NODES[3].baseDemandPerH * (1 + settings.surgePct)) / (BASE_NODES[3].baseCapacityPerH || 1), 0, 1);

  // Orchestration states
  const [activeStage, setActiveStage] = useState("sense");
  const flowStates = [
    { id: "sense", label: "Sense", active: activeStage === "sense", note: "Orders, slots, carriers" },
    { id: "forecast", label: "Forecast", active: activeStage === "forecast", note: "Surge + weather" },
    { id: "decide", label: "Decide", active: activeStage === "decide", note: actions[0]?.title || "Policy steady" },
    { id: "act", label: "Act", active: activeStage === "act", note: "Apply plan & monitor" },
  ];

  // Events
  const [events, setEvents] = useState<{ t: string; who: string; text: string }[]>(() => [...INITIAL_EVENTS]);
  const [streamFilter, setStreamFilter] = useState<"All" | "Agent" | "System">("All");
  const storyTimers = useRef<number[]>([]);
  
  function clearStoryTimers() {
    storyTimers.current.forEach((id) => clearTimeout(id));
    storyTimers.current = [];
  }
  useEffect(() => {
    if (view !== "app") return;
    const t = setInterval(() => {
      const tsNow = ts();
      const picks = [
        `ForecastAgent: Next wave +${Math.round(settings.surgePct * 100)}% vs base; Chicago tight at cutoff.`,
        `PromiseAgent: ${settings.policy} policy → expected OTD ${pct(kpi.otd)}.`,
        settings.upsDrop < 0 ? `CarrierAgent: UPS cap ${Math.round(Math.abs(settings.upsDrop) * 100)}% down; proposing crowd boost.` : `CarrierAgent: Parcel steady; maintain blend.`,
        settings.reserveForMembers ? `MemberAgent: Capacity reserve active for Plus/Total through 8pm.` : `MemberAgent: Consider enabling member reserve (10–15%).`,
      ];
      setEvents((e) => [{ t: tsNow, who: "Agent", text: picks[Math.floor(rng() * picks.length)] }, ...e].slice(0, 30));
    }, 3500);
    return () => clearInterval(t);
  }, [kpi.otd, settings, view]);

  // Apply all proposed actions at once (simple)
  const [applied, setApplied] = useState(false);
  function applyPlan() {
    if (!actions.length) return;
    let next = { ...settings };
    for (const a of actions) next = a.apply(next);
    setSettings(next);
    setApplied(true);
    setActiveStage("act");
    setEvents((e) => [{ t: ts(), who: "Orchestrator", text: `Applied plan: ${actions.map((a) => a.id).join(", ")}` }, ...e]);
  }

  function resetScenario({ logEvent = true, hard = false }: { logEvent?: boolean; hard?: boolean } = {}) {
    clearStoryTimers();
    setSettings({ surgePct: 0.35, weatherIdx: 0.2, plusMix: 0.4, policy: "Balanced", upsDrop: -0.08, fedexDrop: 0.0, crowdBoost: 0.1, reserveForMembers: true, loadBalanceToNewark: 0.0 });
    setApplied(false);
    setActiveStage("sense");
    if (hard) {
      setEvents(() => {
        const base = [...INITIAL_EVENTS];
        return logEvent ? [{ t: ts(), who: "System", text: "Reset to baseline scenario." }, ...base] : base;
      });
    } else if (logEvent) {
      setEvents((e) => [{ t: ts(), who: "System", text: "Reset to baseline scenario." }, ...e]);
    }
  }

  function enterApp() {
    resetScenario({ logEvent: false, hard: true });
    setTab("brief");
    setStreamFilter("All");
    setMetricModal({ open: false });
    setNodeModal({ open: false });
    setHelpOpen(false);
    setStoryRunning(false);
    setView("app");
  }

  function returnToLanding() {
    resetScenario({ logEvent: false, hard: true });
    setStreamFilter("All");
    setTab("brief");
    setMetricModal({ open: false });
    setNodeModal({ open: false });
    setHelpOpen(false);
    setStoryRunning(false);
    setView("landing");
  }

  // Story mode (guided scenario)
  const [storyRunning, setStoryRunning] = useState(false);
  function runStory() {
    if (storyRunning || view !== "app") return;
    clearStoryTimers();
    setStoryRunning(true);
    setActiveStage("sense");
    setEvents((e) => [{ t: ts(), who: "System", text: "Story Mode: Holiday spike begins." }, ...e]);
    const t1 = window.setTimeout(() => setSettings((s) => ({ ...s, surgePct: 0.5 })), 800);
    const t2 = window.setTimeout(() => {
      setActiveStage("forecast");
      setSettings((s) => ({ ...s, upsDrop: -0.12 }));
      setEvents((e) => [{ t: ts(), who: "ForecastAgent", text: "UPS capacity dip detected; risk to same‑day ZIPs." }, ...e]);
    }, 1800);
    const t3 = window.setTimeout(() => {
      setActiveStage("decide");
      setEvents((e) => [{ t: ts(), who: "DecideAgent", text: `Proposed: ${actions.map((a) => a.id).join(", ") || "Tighten promise; crowd boost"}` }, ...e]);
    }, 2800);
    const t4 = window.setTimeout(() => {
      applyPlan();
    }, 3800);
    const t5 = window.setTimeout(() => {
      setStoryRunning(false);
      storyTimers.current = [];
    }, 5200);
    storyTimers.current.push(t1, t2, t3, t4, t5);
  }

  // Modals and interactions
  const [metricModal, setMetricModal] = useState<{ open: boolean; key?: string }>({ open: false });
  const [nodeModal, setNodeModal] = useState<{ open: boolean; node?: Node; util?: number }>({ open: false });
  const [chartTypeA, setChartTypeA] = useState<"area" | "bar" | "line">("area");
  const [chartTypeB, setChartTypeB] = useState<"area" | "bar" | "line">("bar");
  const [chartTypeC, setChartTypeC] = useState<"area" | "bar" | "line">("line");

  const [tab, setTab] = useState<"brief" | "orchestrator">("brief");
  const [helpOpen, setHelpOpen] = useState(false);

  if (view === "landing") {
    const phases = [
      {
        title: "Sense",
        text: "Monitor demand surges, slot health, and carrier signals across MEC, RDC, and store nodes.",
        icon: <MonitorSmartphone className="h-5 w-5 text-gray-200" />,
      },
      {
        title: "Forecast",
        text: "Blend weather friction and membership mix to project on‑time delivery risk before cutoffs break.",
        icon: <Activity className="h-5 w-5 text-gray-200" />,
      },
      {
        title: "Decide",
        text: "Let the agents compare policies, rebalance volume, and recommend capacity moves in context.",
        icon: <Target className="h-5 w-5 text-gray-200" />,
      },
      {
        title: "Act",
        text: "Apply the curated plan, trigger Story Mode, and watch KPIs shift with explainability baked in.",
        icon: <PlayCircle className="h-5 w-5 text-gray-200" />,
      },
    ];

    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 lg:flex-row lg:items-stretch">
          <div className="flex flex-1 flex-col items-center gap-8 text-center lg:items-start lg:text-left">
            <img src={logo} alt="Best Buy synthetic program logo" className="w-36" />
            <div className="space-y-4">
              <div className="text-sm uppercase tracking-[0.4em] text-gray-400">Best Buy · Synthetic Demo</div>
              <h1 className="text-4xl font-semibold text-gray-100 sm:text-5xl">Delivery Promise & Capacity Orchestrator</h1>
              <p className="max-w-xl text-base text-gray-300">
                Navigate the end-to-end promise control tower: sense live constraints, forecast risk, decide the optimal plan,
                and act with one click.
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 text-sm text-gray-300 lg:items-start">
              <button
                onClick={enterApp}
                className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-6 py-3 font-semibold text-gray-900 shadow-lg shadow-gray-900/40 transition hover:brightness-95"
              >
                Enter orchestrator <ArrowRight className="h-4 w-4" />
              </button>
              <div className="text-xs text-gray-500">Jump in to explore Story Mode, scenario controls, and the agent activity stream.</div>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-between gap-8 rounded-3xl border border-gray-800 bg-gray-900/70 p-8 shadow-2xl shadow-black/30">
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-gray-500">Sense → Forecast → Decide → Act</div>
              <div className="mt-3 text-lg font-medium text-gray-200">Phased highlights from the orchestrator</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {phases.map((phase) => (
                <div key={phase.title} className="rounded-2xl border border-gray-800 bg-gray-950/80 p-5 shadow-inner shadow-black/20">
                  <div className="flex items-center gap-3 text-gray-200">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800/80">{phase.icon}</span>
                    <span className="text-base font-medium">{phase.title}</span>
                  </div>
                  <p className="mt-3 text-sm text-gray-400">{phase.text}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-dashed border-gray-800/80 bg-gray-950/60 p-4 text-sm text-gray-400">
              A lightweight Delivery Promise & Capacity Orchestrator. It simulates a Best Buy-like omni network during a holiday surge and shows how an agentic “brain” keeps promises reliable and profitable.
            </div>
          </div>
        </div>
        <div className="pb-12 text-center text-xs text-gray-500">Synthetic data for demo • All figures illustrative • For information: ely.x.colon</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-900/80 bg-gradient-to-b from-gray-950 to-gray-950/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gray-800 flex items-center justify-center shadow-inner"><MonitorSmartphone className="h-5 w-5 text-gray-300"/></div>
            <div>
              <div className="text-sm text-gray-400 uppercase tracking-widest">Best Buy (Synthetic)</div>
              <div className="text-lg font-semibold text-gray-100">Delivery Promise & Capacity Orchestrator</div>
            </div>
          </div>
          <div id="metrics" className="grid grid-cols-4 gap-3">
            <Metric label="On‑Time" value={`${(kpi.otd * 100).toFixed(1)}%`} sub={`Δ ${(kpi.otd - baseline.otd >= 0 ? "+" : "") + ((kpi.otd - baseline.otd) * 100).toFixed(1)} pts`} help="Share of orders delivered within the promised window." onClick={() => setMetricModal({ open: true, key: "otd" })} />
            <Metric label="Orders / day" value={fmt(Math.round(kpi.dailyOrders))} sub="synthetic" help="Projected daily order volume modeled from base demand + surge." onClick={() => setMetricModal({ open: true, key: "orders" })} />
            <Metric label="Conversion" value={`${(kpi.convRate * 100).toFixed(2)}%`} sub={`Δ ${kpi.convLiftPts.toFixed(2)} pts`} help="Checkout conversion impacted by promise reliability and policy." onClick={() => setMetricModal({ open: true, key: "conv" })} />
            <Metric label="Late $ Avoided" value={`$${fmt(Math.round(kpi.lateAvoidedUSD))}`} sub={`@ $${LATE_COST}/late`} help="Appeasement/avoid costs saved vs naive surge baseline." onClick={() => setMetricModal({ open: true, key: "late$" })} />
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-3 flex items-center gap-2">
          <button onClick={() => setTab("brief")} className={`px-3 py-2 rounded-xl border ${tab === "brief" ? "border-gray-600 bg-gray-800/60" : "border-gray-800 bg-gray-900/60"}`}>Executive Daily Brief</button>
          <button onClick={() => setTab("orchestrator")} className={`px-3 py-2 rounded-xl border ${tab === "orchestrator" ? "border-gray-600 bg-gray-800/60" : "border-gray-800 bg-gray-900/60"}`}>Orchestrator</button>
          <div className="flex-1"/>
          <button onClick={runStory} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl ${storyRunning ? "bg-gray-700 text-gray-300" : "bg-gray-200 text-gray-900 hover:brightness-95"}`} title="Auto-play a guided scenario"><Wand2 className="h-4 w-4"/>{storyRunning ? "Story Running" : "Story Mode"}</button>
          <button onClick={applyPlan} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-200 text-gray-900 font-medium hover:brightness-95" title="Apply all recommended actions"><PlayCircle className="h-4 w-4"/>Apply Plan</button>
          <button onClick={resetScenario} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-700 hover:bg-gray-900/60" title="Reset to baseline"><RefreshCw className="h-4 w-4"/>Reset</button>
          <button
            onClick={returnToLanding}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#A100FF] text-white shadow-sm transition hover:bg-[#8c00d9]"
            title="Return to landing page"
          >
            <ArrowLeft className="h-4 w-4" />Landing
          </button>
          <button onClick={() => setHelpOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-700 hover:bg-gray-900/60" title="Open guide"><HelpCircle className="h-4 w-4"/>Help</button>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "brief" ? (
          <section className="grid grid-cols-12 gap-6">
            {/* Left: Brief cards */}
            <div className="col-span-7 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {[{ key: "service", icon: <Clock className="h-4 w-4" />, title: kpi.otd < 0.95 ? "ETA risk rising in Midwest (OTD < 95%)" : "Service stable across nodes (OTD ≥ 95%)", detail: kpi.otd < 0.95 ? "Chicago wave exceeds healthy cutoff capacity during surge hours; favor Reliable policy for non‑members." : "Healthy cutoffs; keep Balanced policy through evening wave.", impact: `${(kpi.otd * 100).toFixed(1)}% on‑time (Δ ${(kpi.otd - baseline.otd) * 100 > 0 ? "+" : ""}${((kpi.otd - baseline.otd) * 100).toFixed(1)} pts)` }, { key: "carrier", icon: <Truck className="h-4 w-4" />, title: settings.upsDrop < 0 ? "UPS capacity soft; consider crowd boost" : "Carrier capacity healthy", detail: settings.upsDrop < 0 ? "Add +15% UberDirect/DD for short‑haul ZIPs to stabilize same‑day." : "Hold crowd capacity flat; optimize cost per order.", impact: `$${kpi.costPerOrder.toFixed(2)} $/order (blend)` }, { key: "member", icon: <Users className="h-4 w-4" />, title: settings.reserveForMembers ? "Member promise protected" : "Enable member capacity reserve", detail: settings.reserveForMembers ? "Plus/Total prioritized at cutoff windows." : "Reserve 10–15% slots for Plus/Total during surge.", impact: `${(kpi.convRate * 100).toFixed(2)}% conversion (Δ ${kpi.convLiftPts.toFixed(2)} pts)` }].map((b) => (
                  <button key={b.key} onClick={() => setMetricModal({ open: true, key: b.key })} className="text-left rounded-2xl border border-gray-800 bg-gray-900/70 p-4 hover:border-gray-600 transition">
                    <div className="flex items-center gap-2 text-gray-300">{b.icon}<span className="text-sm font-medium">{b.title}</span></div>
                    <div className="mt-2 text-sm text-gray-400">{b.detail}</div>
                    <div className="mt-3 text-xs text-gray-500">{b.impact}</div>
                    <div className="mt-2 text-xs text-gray-500">Click to learn how this is calculated.</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <ChartPanel label="Capacity (per bucket)" data={capacitySeries} baseline={baseCap} type={chartTypeA} onTypeCycle={() => setChartTypeA(chartTypeA === "area" ? "bar" : chartTypeA === "bar" ? "line" : "area")} />
                <ChartPanel label="Demand (per bucket)" data={demandSeries} baseline={baseDem} type={chartTypeB} onTypeCycle={() => setChartTypeB(chartTypeB === "area" ? "bar" : chartTypeB === "bar" ? "line" : "area")} />
                <ChartPanel label="Service (OTD%) by bucket" data={otdSeries} baseline={baseOtd} type={chartTypeC} onTypeCycle={() => setChartTypeC(chartTypeC === "area" ? "bar" : chartTypeC === "bar" ? "line" : "area")} />
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="text-sm text-gray-300 mb-3 flex items-center gap-2"><Target className="h-4 w-4"/> Recommended Actions (Auto‑Generated) <Tooltip text="Proposed by the agent given current risk & capacity."/></div>
                {actions.length ? (
                  <div className="space-y-2">
                    {actions.map((a) => (
                      <div key={a.id} className="rounded-xl border border-gray-800 bg-gray-950 p-3 flex items-center justify-between hover:border-gray-600 transition">
                        <div>
                          <div className="text-sm text-gray-200 font-medium">{a.title}</div>
                          <div className="text-xs text-gray-500">{a.detail}</div>
                        </div>
                        <div className="text-xs text-gray-400">{a.impact}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">No changes proposed. Holding steady.</div>
                )}
              </div>
            </div>

            {/* Right: Orchestration + Stream */}
            <div className="col-span-5 space-y-4">
              <OrchestrationFlow states={flowStates} onPick={setActiveStage} />
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">Click a stage above to focus the agent narrative.</div>
                <div className="flex items-center gap-2 text-xs">
                  <button className={`px-2 py-1 rounded-lg border ${streamFilter === "All" ? "border-gray-600" : "border-gray-800"}`} onClick={() => setStreamFilter("All")}>All</button>
                  <button className={`px-2 py-1 rounded-lg border ${streamFilter === "Agent" ? "border-gray-600" : "border-gray-800"}`} onClick={() => setStreamFilter("Agent")}>Agent</button>
                  <button className={`px-2 py-1 rounded-lg border ${streamFilter === "System" ? "border-gray-600" : "border-gray-800"}`} onClick={() => setStreamFilter("System")}>System</button>
                </div>
              </div>
              <AgentStream events={events} filter={streamFilter} />
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-12 gap-6">
            {/* Left: Controls */}
            <div className="col-span-4 space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="text-sm text-gray-300 mb-3 flex items-center gap-2"><Settings className="h-4 w-4"/> Scenario Controls <Tooltip text="Change the world; agents will respond."/></div>
                <div className="space-y-4">
                  <Slider label="Holiday Surge" help="% demand over base. Drives waves & cutoffs." value={settings.surgePct} onChange={(v: number) => setSettings({ ...settings, surgePct: v })} />
                  <Slider label="Weather Severity" help="Worse weather reduces on‑time (OTP)." value={settings.weatherIdx} onChange={(v: number) => setSettings({ ...settings, weatherIdx: v })} />
                  <Slider label="Membership Mix (Plus/Total)" help="Share of member orders; may reserve capacity." value={settings.plusMix} onChange={(v: number) => setSettings({ ...settings, plusMix: v })} />

                  <div className="grid grid-cols-3 gap-2">
                    {(["Aggressive", "Balanced", "Reliable"] as Policy[]).map((p) => (
                      <button key={p} onClick={() => setSettings({ ...settings, policy: p })} className={`px-3 py-2 rounded-xl border text-sm ${settings.policy === p ? "border-gray-600 bg-gray-800/60" : "border-gray-800 bg-gray-900/60"}`}>{p}</button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Slider label="UPS Capacity Δ" help="Relative to normal daily cap." value={settings.upsDrop + 0.5} min={0} max={1} step={0.01} onChange={(v: number) => setSettings({ ...settings, upsDrop: v - 0.5 })} />
                    <Slider label="FedEx Capacity Δ" help="Relative to normal daily cap." value={settings.fedexDrop + 0.5} min={0} max={1} step={0.01} onChange={(v: number) => setSettings({ ...settings, fedexDrop: v - 0.5 })} />
                  </div>

                  <Slider label="Crowd Capacity Boost" help="Adds burst capacity via UberDirect/DD." value={settings.crowdBoost} onChange={(v: number) => setSettings({ ...settings, crowdBoost: v })} />
                  <Toggle label="Reserve Capacity for Members" help="Protect Plus/Total promise windows." checked={settings.reserveForMembers} onChange={(v) => setSettings({ ...settings, reserveForMembers: v })} />
                  <Slider label="Rebalance to Newark" help="Shift from MEC‑1 to MEC‑2 to relieve Chicago." value={settings.loadBalanceToNewark} onChange={(v: number) => setSettings({ ...settings, loadBalanceToNewark: v })} />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="text-sm text-gray-300 mb-3 flex items-center gap-2"><Database className="h-4 w-4"/> Synthetic Data (fixed seed) <Tooltip text="Names & figures are illustrative."/></div>
                <div className="text-xs text-gray-400">Nodes: {BASE_NODES.map((n) => n.id).join(", ")}</div>
                <div className="text-xs text-gray-400 mt-1">Carriers: {BASE_CARRIERS.map((c) => c.name).join(", ")}</div>
              </div>
            </div>

            {/* Middle: Nodes & Charts */}
            <div className="col-span-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <NodeCard name="MEC‑1 Chicago" city="Chicago, IL" util={utilChicago} onClick={() => setNodeModal({ open: true, node: BASE_NODES[0], util: utilChicago })} />
                <NodeCard name="RDC‑East Columbus" city="Columbus, OH" util={utilColumbus} onClick={() => setNodeModal({ open: true, node: BASE_NODES[1], util: utilColumbus })} />
                <NodeCard name="Store‑102 Lincoln Park" city="Chicago, IL" util={utilStore} onClick={() => setNodeModal({ open: true, node: BASE_NODES[2], util: utilStore })} />
                <NodeCard name="MEC‑2 Newark" city="Newark, NJ" util={utilNewark} onClick={() => setNodeModal({ open: true, node: BASE_NODES[3], util: utilNewark })} />
              </div>

              <ChartPanel label="Capacity − Demand" data={kpi.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.capacity - h.demand) }))} baseline={baseline.hourly.map((h, i) => ({ x: `T${i + 1}`, y: Math.round(h.capacity - h.demand) }))} type={chartTypeA} onTypeCycle={() => setChartTypeA(chartTypeA === "area" ? "bar" : chartTypeA === "bar" ? "line" : "area")} />
              <ChartPanel label="On‑Time by bucket (%)" data={otdSeries} baseline={baseOtd} type={chartTypeC} onTypeCycle={() => setChartTypeC(chartTypeC === "area" ? "bar" : chartTypeC === "bar" ? "line" : "area")} />
            </div>

            {/* Right: Stream */}
            <div className="col-span-3 space-y-4">
              <AgentStream events={events} filter={streamFilter} />
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="text-sm text-gray-300 mb-2 flex items-center gap-2">Impact Snapshot <Tooltip text="Quick deltas vs baseline." /></div>
                <div className="grid grid-cols-1 gap-2 text-sm text-gray-300">
                  <div className="flex items-center justify-between"><span>Δ On‑Time</span><span className={`${kpi.otd - baseline.otd >= 0 ? "text-gray-200" : "text-red-300"}`}>{((kpi.otd - baseline.otd) * 100).toFixed(1)} pts</span></div>
                  <div className="flex items-center justify-between"><span>Δ Conversion</span><span className={`${kpi.convLiftPts >= 0 ? "text-gray-200" : "text-red-300"}`}>{kpi.convLiftPts.toFixed(2)} pts</span></div>
                  <div className="flex items-center justify-between"><span>Late $ Avoided</span><span>${fmt(Math.round(kpi.lateAvoidedUSD))}/day</span></div>
                  <div className="flex items-center justify-between"><span>Blended $/Order</span><span>${kpi.costPerOrder.toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-gray-500">
        Synthetic data for demo • All figures illustrative • For information: ely.x.colon
      </footer>

      {/* Modals */}
      <Modal open={metricModal.open} onClose={() => setMetricModal({ open: false })} title="Metric Details">
        {metricModal.key === "otd" && (
          <div>
            <div className="mb-2">**On‑Time (OTD)** = Orders delivered within promised window ÷ All delivered orders.</div>
            <ul className="list-disc ml-5 text-gray-400 space-y-1">
              <li>Driven by slot capacity, carrier OTP and policy (Aggressive ↔ Reliable).</li>
              <li>Weather penalty reduces OTD; member reserve can boost it.</li>
              <li>We show dashed baseline for comparison.</li>
            </ul>
          </div>
        )}
        {metricModal.key === "orders" && (
          <div>
            <div>**Orders/day** is simulated from base demand, time‑of‑day wave shape, and the <i>Holiday Surge</i> slider.</div>
          </div>
        )}
        {metricModal.key === "conv" && (
          <div>
            <div>**Conversion** lifts with trustworthy ETAs and drops with over‑aggressive promises. Baseline = 2.4%.</div>
          </div>
        )}
        {metricModal.key === "late$" && (
          <div>
            <div>**Late $ Avoided** ≈ (Baseline Late% − Current Late%) × Orders × ${LATE_COST} per late.</div>
          </div>
        )}
        {metricModal.key === "service" && (
          <div>
            <div>Service tile summarizes OTD and cut‑off health with a recommended stance.</div>
          </div>
        )}
        {metricModal.key === "carrier" && (
          <div>
            <div>Carrier tile reflects parcel vs crowd capacity, and its effect on $/order.</div>
          </div>
        )}
        {metricModal.key === "member" && (
          <div>
            <div>Membership tile shows whether capacity reserve is protecting Plus/Total ETAs.</div>
          </div>
        )}
      </Modal>

      <Modal open={nodeModal.open} onClose={() => setNodeModal({ open: false })} title={nodeModal.node ? `${nodeModal.node.id} – Details` : "Node Details"}>
        {nodeModal.node && (
          <div className="space-y-3">
            <div className="text-gray-400">Location: {nodeModal.node.city} • Type: {nodeModal.node.type}</div>
            <div className="flex items-center gap-4 text-sm">
              <Pill>Base Cap/hr: {nodeModal.node.baseCapacityPerH}</Pill>
              <Pill>Base Dem/hr: {nodeModal.node.baseDemandPerH}</Pill>
              <Pill>Util: {pct(nodeModal.util || 0)}</Pill>
            </div>
            <div className="text-sm text-gray-300">Levers</div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setSettings((s) => ({ ...s, loadBalanceToNewark: clamp(s.loadBalanceToNewark + 0.1, 0, 0.5) }))} className="rounded-lg border border-gray-700 px-3 py-2 hover:border-gray-500">Shift volume away</button>
              <button onClick={() => setSettings((s) => ({ ...s, policy: "Reliable" }))} className="rounded-lg border border-gray-700 px-3 py-2 hover:border-gray-500">Relax promises here</button>
            </div>
            <div className="text-xs text-gray-500">Tip: These levers simulate playbooks (pre‑allocation, policy by region).</div>
          </div>
        )}
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Quick Start Guide">
        <div className="space-y-3">
          <div><b>What this is:</b> a lightweight demo to orchestrate delivery promises during peak. Agents *sense* demand/capacity, *forecast* risk, *decide* actions, and *act* to protect ETA and conversion.</div>
          <div><b>How to demo:</b> 1) Tap <i>Story Mode</i> to auto‑play surge → risk → plan → improvement. 2) Click tiles to see definitions and drivers. 3) Use the <i>Orchestrator</i> tab to tweak the world and watch KPIs shift. 4) Hit <i>Apply Plan</i> to execute recommendations.</div>
          <div><b>Tiles:</b> All tiles are clickable and have tooltips (ⓘ). Hover charts; dashed lines show baselines. The Activity stream narrates agent behavior.</div>
          <div className="text-xs text-gray-500">All data is synthetic and illustrative.</div>
        </div>
      </Modal>
    </div>
  );
}
