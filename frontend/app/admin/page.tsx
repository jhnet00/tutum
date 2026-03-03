"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GRAFANA  = "http://192.168.56.30:3000";

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  blue:    "#60a5fa",
  violet:  "#a78bfa",
  emerald: "#10b981",
  amber:   "#f59e0b",
  red:     "#ef4444",
  slate:   "#94a3b8",
  cyan:    "#22d3ee",
  pink:    "#f472b6",
};

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeInfo  = { name: string; role: string; status: string; cpu_percent: number; memory_percent: number; ip: string };
type PodInfo   = { name: string; namespace: string; status: string; restarts: number; node: string; age: string; ready: string };
type LogEntry  = { time: string; timestamp: number; level: string; namespace: string; pod: string; msg: string };
type DiagIssue = { level: "WARN" | "ERROR"; title: string; detail: string };
type DiagRec   = { priority: "HIGH" | "MEDIUM" | "LOW"; action: string };
type Diagnosis = { severity: "OK" | "WARN" | "CRITICAL"; summary: string; issues: DiagIssue[]; recommendations: DiagRec[] };
type WorkerStatus = { status: string; restarts: number; age: string; running: boolean };
type PipelineData = {
  workers: Record<string, WorkerStatus>;
  mongodb: { news_total: number; news_last_1h: number; available: boolean };
  elasticsearch: { news_docs: number; available: boolean };
  recent_logs: Record<string, string[]>;
};
type PipelineComponent = { name: string; label: string; status: "OK" | "WARN" | "ERROR"; summary: string; issues: { title: string; detail: string }[]; actions: { priority: string; action: string }[] };
type PipelineDiagnosis = { overall: "OK" | "WARN" | "CRITICAL"; components: PipelineComponent[] };
type MetricsData = { rps: number[]; latency_p95: number[]; error_rate: number[]; kafka_lag: number[] };
type PvcInfo    = { name: string; namespace: string; status: string; capacity: string; storage_class: string; volume: string };
type DataMetrics = {
  redis:         { memory_used_gb: number|null; memory_max_gb: number|null; memory_pct: number|null; clients: number|null; hit_rate_pct: number|null; available: boolean };
  kafka:         { consumer_lag: number|null; throughput_msg_per_min: number|null; available: boolean };
  elasticsearch: { indexing_rate: number|null; jvm_heap_used_gb: number|null; jvm_heap_max_gb: number|null; jvm_heap_pct: number|null; available: boolean };
};
type TraceEntry = { traceID: string; rootServiceName: string; rootTraceName: string; durationMs: number; startTimeMs: number; grafana_url: string };

// ─── Worker meta ──────────────────────────────────────────────────────────────
const WORKER_META: Record<string, { label: string; desc: string; icon: string; color: string; group: string }> = {
  "news-producer":    { label: "뉴스 수집",    desc: "Einfomax → Kafka",       icon: "📡", color: C.blue,    group: "news"  },
  "news-consumer":    { label: "MongoDB 저장", desc: "Kafka → MongoDB",        icon: "🗄️", color: C.emerald, group: "news"  },
  "elastic-consumer": { label: "ES 인덱싱",   desc: "Kafka → Elasticsearch",  icon: "🔍", color: C.violet,  group: "news"  },
  "price-producer":   { label: "시세 수집",    desc: "Exchange → Kafka",       icon: "📈", color: C.cyan,   group: "price" },
  "price-consumer":   { label: "시세 저장",    desc: "Kafka → MariaDB",        icon: "💰", color: C.pink,   group: "price" },
  "email-worker":     { label: "이메일 발송",  desc: "알림 이메일 처리",         icon: "📧", color: C.amber,  group: "other" },
  "ocr-worker":       { label: "OCR 처리",     desc: "이미지 텍스트 추출",      icon: "🔬", color: C.slate,  group: "other" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function GaugeBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(value, 100);
  const bar = pct > 85 ? C.red : pct > 65 ? C.amber : color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: bar }} />
      </div>
      <span className="text-xs font-mono w-9 text-right" style={{ color: bar }}>{value}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Ready:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    OK:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Bound:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    WARN:    "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Failed:  "bg-red-500/20 text-red-400 border-red-500/30",
    Error:   "bg-red-500/20 text-red-400 border-red-500/30",
    ERROR:   "bg-red-500/20 text-red-400 border-red-500/30",
    Lost:    "bg-red-500/20 text-red-400 border-red-500/30",
    Stopped: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    Unknown: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"}`}>
      {status}
    </span>
  );
}

function LogLevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    INFO: "text-sky-400", WARN: "text-amber-400", ERROR: "text-red-400", DEBUG: "text-slate-500",
  };
  return <span className={`font-mono text-xs font-bold w-10 ${map[level] ?? "text-slate-400"}`}>{level}</span>;
}

function Skel({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-white/[0.06] rounded-md animate-pulse`} />;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">{children}</h3>;
}

function Val({ v, unit = "", decimals = 1 }: { v: number | null | undefined; unit?: string; decimals?: number }) {
  if (v == null) return <span className="text-white/20">N/A</span>;
  return <>{v.toFixed(decimals)}{unit && <span className="text-white/40 text-sm ml-0.5">{unit}</span>}</>;
}

// Sparkline using recharts (minimal, no axes)
function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length === 0) return <div style={{ height }} className="bg-white/5 rounded" />;
  const pts = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
              fill={`url(#sg-${color.replace("#", "")})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Custom tooltip for recharts
function ChartTooltip({ active, payload, label, unit = "" }: { active?: boolean; payload?: {color: string; name: string; value: number}[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1224] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white/40 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-mono">{p.value?.toFixed(1)}{unit}</span></p>
      ))}
    </div>
  );
}

function SevColors(sev: "OK" | "WARN" | "CRITICAL") {
  return sev === "CRITICAL"
    ? { bg: "bg-red-500/10",     border: "border-red-500/20",     text: "text-red-400",     dot: "bg-red-400" }
    : sev === "WARN"
    ? { bg: "bg-amber-500/10",   border: "border-amber-500/20",   text: "text-amber-400",   dot: "bg-amber-400" }
    : { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", dot: "bg-emerald-400" };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  type Tab = "overview" | "infra" | "pipeline" | "logs" | "traces" | "ai";
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Cluster state
  const [nodes,        setNodes]        = useState<NodeInfo[]>([]);
  const [pods,         setPods]         = useState<PodInfo[]>([]);
  const [metrics,      setMetrics]      = useState<MetricsData | null>(null);
  const [pvcs,         setPvcs]         = useState<PvcInfo[]>([]);
  const [dataMetrics,  setDataMetrics]  = useState<DataMetrics | null>(null);
  const [traces,       setTraces]       = useState<TraceEntry[]>([]);
  const [pipeline,     setPipeline]     = useState<PipelineData | null>(null);
  const [logs,         setLogs]         = useState<LogEntry[]>([]);
  const [diagnosis,    setDiagnosis]    = useState<Diagnosis | null>(null);
  const [pipelineDiag, setPipelineDiag] = useState<PipelineDiagnosis | null>(null);

  // Loading states
  const [loadingNodes,   setLoadingNodes]   = useState(true);
  const [loadingPods,    setLoadingPods]    = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [loadingDataM,   setLoadingDataM]   = useState(true);
  const [loadingTraces,  setLoadingTraces]  = useState(true);
  const [loadingPipeline,setLoadingPipeline]= useState(true);
  const [loadingLogs,    setLoadingLogs]    = useState(true);
  const [loadingDiag,    setLoadingDiag]    = useState(false);
  const [loadingPDiag,   setLoadingPDiag]   = useState(false);

  // Pods tab filter
  const [nsFilter,  setNsFilter]  = useState("all");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [logNs,     setLogNs]     = useState("tutum-app");
  const [logLevel,  setLogLevel]  = useState("ALL");
  const [logPod,    setLogPod]    = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [clock, setClock] = useState("");

  // Overall cluster health from nodes + pods
  const clusterHealth = (() => {
    if (!nodes.length) return "UNKNOWN";
    const hasNotReady = nodes.some(n => n.status !== "Ready");
    if (hasNotReady) return "CRITICAL";
    const hasHighCpu = nodes.some(n => n.cpu_percent > 85);
    const hasHighMem = nodes.some(n => n.memory_percent > 85);
    if (hasHighCpu || hasHighMem) return "WARN";
    return "OK";
  })();

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch helpers
  const fetchNodes = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/nodes`);
      if (r.ok) { const d = await r.json(); setNodes(d.nodes || []); }
    } catch {} finally { setLoadingNodes(false); setLastUpdated(new Date().toLocaleTimeString("ko-KR")); }
  }, []);

  const fetchPods = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pods`);
      if (r.ok) { const d = await r.json(); setPods(d.pods || []); }
    } catch {} finally { setLoadingPods(false); }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/metrics`);
      if (r.ok) setMetrics(await r.json());
    } catch {} finally { setLoadingMetrics(false); }
  }, []);

  const fetchStorage = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/storage`);
      if (r.ok) { const d = await r.json(); setPvcs(d.pvcs || []); }
    } catch {} finally { setLoadingStorage(false); }
  }, []);

  const fetchDataMetrics = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/data-metrics`);
      if (r.ok) setDataMetrics(await r.json());
    } catch {} finally { setLoadingDataM(false); }
  }, []);

  const fetchTraces = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/traces?limit=20&min_duration_ms=50`);
      if (r.ok) { const d = await r.json(); setTraces(d.traces || []); }
    } catch {} finally { setLoadingTraces(false); }
  }, []);

  const fetchPipeline = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pipeline`);
      if (r.ok) setPipeline(await r.json());
    } catch {} finally { setLoadingPipeline(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/logs?namespace=${logNs}&limit=100`);
      if (r.ok) { const d = await r.json(); setLogs(d.logs || []); }
    } catch {} finally { setLoadingLogs(false); }
  }, [logNs]);

  // Initial + polling
  useEffect(() => {
    fetchNodes(); fetchPods(); fetchMetrics(); fetchStorage(); fetchDataMetrics(); fetchTraces(); fetchPipeline(); fetchLogs();
    const id30 = setInterval(() => { fetchNodes(); fetchPods(); fetchMetrics(); fetchStorage(); fetchDataMetrics(); fetchPipeline(); }, 30_000);
    const id10 = setInterval(() => fetchLogs(), 10_000);
    const id60 = setInterval(() => fetchTraces(), 60_000);
    return () => { clearInterval(id30); clearInterval(id10); clearInterval(id60); };
  }, [fetchNodes, fetchPods, fetchMetrics, fetchStorage, fetchDataMetrics, fetchTraces, fetchPipeline, fetchLogs]);

  // Metrics time series data for charts
  const metricsChartData = (() => {
    if (!metrics) return [];
    const len = Math.max(metrics.rps.length, metrics.latency_p95.length);
    return Array.from({ length: len }, (_, i) => ({
      t: `-${(len - i - 1) * 5}m`,
      rps: metrics.rps[i] ?? 0,
      lat: metrics.latency_p95[i] ?? 0,
      err: metrics.error_rate[i] ?? 0,
      lag: metrics.kafka_lag[i] ?? 0,
    }));
  })();

  // Pod status breakdown for pie
  const podStats = (() => {
    const counts: Record<string, number> = { Running: 0, Pending: 0, Failed: 0, Evicted: 0 };
    const pendingStates = new Set(["Pending", "ContainerCreating", "PodInitializing"]);
    const failedStates = new Set(["Failed", "Error", "CrashLoopBackOff", "OOMKilled", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError"]);

    pods.forEach(p => {
      if (p.status === "Running") counts.Running++;
      else if (p.status === "Evicted") counts.Evicted++;
      else if (pendingStates.has(p.status)) counts.Pending++;
      else if (failedStates.has(p.status)) counts.Failed++;
      else counts.Failed++;
    });

    return [
      { name: "Running", value: counts.Running, color: C.emerald },
      { name: "Pending", value: counts.Pending, color: C.amber },
      { name: "Failed",  value: counts.Failed,  color: C.red },
      { name: "Evicted", value: counts.Evicted, color: C.slate },
    ].filter(d => d.value > 0);
  })();

  const podNodeOptions = ["all", ...Array.from(new Set(pods.map(p => p.node).filter(Boolean))).sort()];
  const filteredPods = pods.filter(p =>
    (nsFilter === "all" || p.namespace === nsFilter) &&
    (nodeFilter === "all" || p.node === nodeFilter)
  );
  const filteredLogs = logs.filter(l =>
    (logLevel === "ALL" || l.level === logLevel) &&
    (!logPod || l.pod.includes(logPod))
  );

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview",  label: "Overview",    icon: "◈" },
    { id: "infra",     label: "Infra",       icon: "⬡" },
    { id: "pipeline",  label: "Pipeline",    icon: "⇄" },
    { id: "logs",      label: "Logs",        icon: "≡" },
    { id: "traces",    label: "Traces",      icon: "∿" },
    { id: "ai",        label: "AI 분석",     icon: "✦" },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen text-white" style={{ background: "#080d1a", fontFamily: "'Inter', sans-serif" }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080d1a]/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight" style={{ color: C.blue }}>⬡ Tutum</span>
            <span className="text-white/30 text-sm font-medium">Admin</span>
          </div>

          {/* Cluster health */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium"
               style={{
                 borderColor: clusterHealth === "OK" ? "#10b981/30" : clusterHealth === "WARN" ? "#f59e0b/30" : "#ef4444/30",
                 color: clusterHealth === "OK" ? C.emerald : clusterHealth === "WARN" ? C.amber : C.red,
                 background: clusterHealth === "OK" ? "rgba(16,185,129,0.08)" : clusterHealth === "WARN" ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)",
               }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: clusterHealth === "OK" ? C.emerald : clusterHealth === "WARN" ? C.amber : C.red }} />
            Cluster {clusterHealth}
          </div>

          {/* Right: time + refresh */}
          <div className="flex items-center gap-4 text-xs text-white/40">
            <span className="font-mono">{clock}</span>
            {lastUpdated && <span>갱신 {lastUpdated}</span>}
            <button onClick={() => { fetchNodes(); fetchPods(); fetchMetrics(); fetchStorage(); fetchDataMetrics(); fetchPipeline(); fetchLogs(); fetchTraces(); }}
                    className="px-3 py-1 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition text-white/60 hover:text-white text-xs">
              ↺ 새로고침
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-6 flex gap-1 pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
                      activeTab === t.id
                        ? "border-blue-400 text-blue-400"
                        : "border-transparent text-white/40 hover:text-white/70"
                    }`}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">

        {/* ══════════════════════════════════════════════════════════════════
            TAB: OVERVIEW
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <div className="space-y-6">

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "RPS",        val: metrics?.rps.at(-1),          unit: "",    data: metrics?.rps,          color: C.blue,    decimals: 1 },
                { label: "P95 Latency",val: metrics?.latency_p95.at(-1),  unit: "ms",  data: metrics?.latency_p95,  color: C.violet,  decimals: 0 },
                { label: "Error Rate", val: metrics?.error_rate.at(-1),   unit: "%",   data: metrics?.error_rate,   color: C.red,     decimals: 2 },
                { label: "Kafka Lag",  val: metrics?.kafka_lag.at(-1),    unit: "",    data: metrics?.kafka_lag,    color: C.amber,   decimals: 0 },
              ].map(kpi => (
                <Card key={kpi.label}>
                  <p className="text-xs text-white/40 mb-1">{kpi.label}</p>
                  {loadingMetrics ? (
                    <><Skel h="h-8" w="w-24" /><Skel h="h-8" /></>
                  ) : (
                    <>
                      <p className="text-2xl font-bold font-mono mb-2" style={{ color: kpi.color }}>
                        <Val v={kpi.val} unit={kpi.unit} decimals={kpi.decimals} />
                      </p>
                      <Sparkline data={kpi.data ?? []} color={kpi.color} />
                    </>
                  )}
                </Card>
              ))}
            </div>

            {/* RPS + Latency combined line chart */}
            <Card>
              <SectionTitle>API 처리량 / 응답시간 (최근 1시간)</SectionTitle>
              {loadingMetrics ? (
                <Skel h="h-48" />
              ) : metricsChartData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-white/20 text-sm">Mimir 데이터 없음</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={metricsChartData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
                    <Line yAxisId="l" type="monotone" dataKey="rps" name="RPS" stroke={C.blue}   strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="r" type="monotone" dataKey="lat" name="P95 ms" stroke={C.violet} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Error rate + Kafka lag */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle>에러율 (5xx %)</SectionTitle>
                {loadingMetrics ? <Skel h="h-36" /> : metricsChartData.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-white/20 text-sm">데이터 없음</div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={metricsChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip unit="%" />} />
                      <Bar dataKey="err" name="Error %" fill={C.red} fillOpacity={0.7} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
              <Card>
                <SectionTitle>Kafka Consumer Lag</SectionTitle>
                {loadingMetrics ? <Skel h="h-36" /> : metricsChartData.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-white/20 text-sm">데이터 없음</div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={metricsChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lagGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={C.amber} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={C.amber} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="lag" name="Lag" stroke={C.amber} strokeWidth={2}
                            fill="url(#lagGrad)" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            {/* Cluster summary bottom row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "노드", val: nodes.length, sub: `Ready ${nodes.filter(n => n.status === "Ready").length}`, color: C.blue },
                { label: "파드", val: pods.length, sub: `Running ${pods.filter(p => p.status === "Running").length}`, color: C.emerald },
                { label: "스토리지 PVC", val: pvcs.length, sub: `Bound ${pvcs.filter(p => p.status === "Bound").length}`, color: C.violet },
              ].map(s => (
                <Card key={s.label} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                       style={{ background: `${s.color}18` }}>◈</div>
                  <div>
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.val}</p>
                    <p className="text-xs text-white/40">{s.label} · {s.sub}</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: INFRA
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "infra" && (
          <div className="space-y-6">

            {/* Node grid */}
            <div>
              <SectionTitle>노드 ({nodes.length})</SectionTitle>
              {loadingNodes ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => <Card key={i}><Skel h="h-20" /></Card>)}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {nodes.map(n => (
                    <Card key={n.name} className="cursor-pointer hover:border-white/20 transition"
                          onClick={() => { setActiveTab("infra"); setNsFilter("all"); setNodeFilter(n.name); }}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold text-sm">{n.name}</p>
                          <p className="text-xs text-white/30 font-mono">{n.ip}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={n.status} />
                          <span className="text-[10px] text-white/30">{n.role}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div>
                          <p className="text-[10px] text-white/30 mb-0.5">CPU</p>
                          <GaugeBar value={n.cpu_percent} color={C.blue} />
                        </div>
                        <div>
                          <p className="text-[10px] text-white/30 mb-0.5">Memory</p>
                          <GaugeBar value={n.memory_percent} color={C.violet} />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Pod status pie + PVC table */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle>파드 상태 분포 ({pods.length}개)</SectionTitle>
                {loadingPods ? <Skel h="h-48" /> : (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={podStats} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                             dataKey="value" isAnimationActive={false}>
                          {podStats.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
                        </Pie>
                        <Tooltip formatter={(v: number, n: string) => [`${v}개`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2">
                      {podStats.map(d => (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                          <span className="text-white/60">{d.name}</span>
                          <span className="font-mono font-bold" style={{ color: d.color }}>{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <SectionTitle>스토리지 (PVC)</SectionTitle>
                {loadingStorage ? <Skel h="h-48" /> : pvcs.length === 0 ? (
                  <p className="text-white/20 text-sm">PVC 없음</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {pvcs.map(p => (
                      <div key={`${p.namespace}/${p.name}`}
                           className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                        <div>
                          <p className="text-xs font-medium">{p.name}</p>
                          <p className="text-[10px] text-white/30">{p.namespace} · {p.storage_class}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-white/60">{p.capacity}</span>
                          <StatusBadge status={p.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Pod table */}
            <Card>
              <div className="flex items-center justify-between mb-3 gap-2">
                <SectionTitle>
                  파드 목록
                  {nodeFilter !== "all" && <span className="text-xs text-blue-400/80 ml-2">node: {nodeFilter}</span>}
                </SectionTitle>
                <div className="flex items-center gap-2">
                  <select value={nsFilter} onChange={e => setNsFilter(e.target.value)}
                          className="text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-white/60 outline-none">
                    {["all", "tutum-app", "tutum-data", "monitoring", "keda"].map(ns => (
                      <option key={ns} value={ns}>{ns}</option>
                    ))}
                  </select>
                  <select value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}
                          className="text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-white/60 outline-none">
                    {podNodeOptions.map(node => (
                      <option key={node} value={node}>{node}</option>
                    ))}
                  </select>
                </div>
              </div>
              {loadingPods ? <Skel h="h-40" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/30 text-left border-b border-white/[0.06]">
                        {["이름","네임스페이스","상태","Ready","재시작","노드","나이"].map(h => (
                          <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPods.map(p => (
                        <tr key={`${p.namespace}/${p.name}`}
                            className="border-b border-white/[0.03] hover:bg-white/[0.02] transition">
                          <td className="py-1.5 pr-4 font-mono max-w-[180px] truncate">{p.name}</td>
                          <td className="py-1.5 pr-4 text-white/50">{p.namespace}</td>
                          <td className="py-1.5 pr-4"><StatusBadge status={p.status} /></td>
                          <td className="py-1.5 pr-4 font-mono text-white/50">{p.ready}</td>
                          <td className="py-1.5 pr-4">
                            <span className={p.restarts > 0 ? "text-amber-400 font-bold" : "text-white/30"}>{p.restarts}</span>
                          </td>
                          <td className="py-1.5 pr-4 text-white/50">{p.node}</td>
                          <td className="py-1.5 text-white/30">{p.age}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: PIPELINE
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "pipeline" && (
          <div className="space-y-6">

            {/* Worker groups */}
            {[
              { title: "뉴스 파이프라인",  workers: ["news-producer", "news-consumer", "elastic-consumer"] },
              { title: "시세 파이프라인",  workers: ["price-producer", "price-consumer"] },
              { title: "기타 워커",        workers: ["email-worker", "ocr-worker"] },
            ].map(group => (
              <div key={group.title}>
                <SectionTitle>{group.title}</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.workers.map(wid => {
                    const meta   = WORKER_META[wid];
                    const wdata  = pipeline?.workers[wid];
                    const status = wdata?.running ? "Running" : wdata?.status ?? "Unknown";
                    return (
                      <Card key={wid} className="border-l-2" style={{ borderLeftColor: meta.color }}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{meta.icon}</span>
                            <div>
                              <p className="text-sm font-semibold">{meta.label}</p>
                              <p className="text-[10px] text-white/30">{meta.desc}</p>
                            </div>
                          </div>
                          {loadingPipeline ? <Skel w="w-14" h="h-5" /> : <StatusBadge status={status} />}
                        </div>
                        {loadingPipeline ? (
                          <Skel h="h-4" />
                        ) : (
                          <div className="flex gap-4 text-xs text-white/40">
                            <span>재시작 <span className={wdata?.restarts ? "text-amber-400 font-bold" : "text-white/30"}>{wdata?.restarts ?? 0}</span></span>
                            <span>가동 <span className="text-white/60">{wdata?.age ?? "-"}</span></span>
                          </div>
                        )}
                        {/* 최근 로그 */}
                        {pipeline?.recent_logs[wid]?.[0] && (
                          <p className="mt-2 text-[10px] text-white/20 font-mono truncate border-t border-white/[0.04] pt-1.5">
                            {pipeline.recent_logs[wid][0]}
                          </p>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Data layer metrics */}
            <div>
              <SectionTitle>데이터 레이어</SectionTitle>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* MongoDB */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">🗄 MongoDB</p>
                  {loadingPipeline ? <Skel h="h-16" /> : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">전체 뉴스</span>
                        <span className="font-mono font-bold" style={{ color: C.emerald }}>
                          {pipeline?.mongodb.available ? (pipeline.mongodb.news_total ?? "N/A").toLocaleString() : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">최근 1h 추가</span>
                        <span className="font-mono" style={{ color: C.blue }}>
                          {pipeline?.mongodb.available ? `+${pipeline.mongodb.news_last_1h}` : "N/A"}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Elasticsearch */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">🔍 Elasticsearch</p>
                  {loadingPipeline ? <Skel h="h-16" /> : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">인덱스 문서</span>
                        <span className="font-mono font-bold" style={{ color: C.violet }}>
                          {pipeline?.elasticsearch.available ? (pipeline.elasticsearch.news_docs ?? "N/A").toLocaleString() : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">동기화율</span>
                        <span className="font-mono" style={{ color: C.cyan }}>
                          {pipeline?.elasticsearch.available && pipeline?.mongodb.available && pipeline.mongodb.news_total > 0
                            ? `${Math.round(pipeline.elasticsearch.news_docs / pipeline.mongodb.news_total * 100)}%`
                            : "N/A"}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Redis (from data-metrics) */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">⚡ Redis</p>
                  {loadingDataM ? <Skel h="h-16" /> : !dataMetrics?.redis.available ? (
                    <p className="text-xs text-white/20">메트릭 없음</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Hit Rate</span>
                        <span className="font-mono font-bold" style={{ color: C.emerald }}>
                          <Val v={dataMetrics.redis.hit_rate_pct} unit="%" decimals={1} />
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">메모리</span>
                        <span className="font-mono" style={{ color: C.blue }}>
                          <Val v={dataMetrics.redis.memory_pct} unit="%" decimals={0} />
                        </span>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Kafka (from data-metrics) */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">📨 Kafka</p>
                  {loadingDataM ? <Skel h="h-16" /> : !dataMetrics?.kafka.available ? (
                    <p className="text-xs text-white/20">메트릭 없음</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Consumer Lag</span>
                        <span className="font-mono font-bold" style={{ color: (dataMetrics.kafka.consumer_lag ?? 0) > 100 ? C.amber : C.emerald }}>
                          {dataMetrics.kafka.consumer_lag ?? "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">처리량/분</span>
                        <span className="font-mono" style={{ color: C.blue }}>
                          <Val v={dataMetrics.kafka.throughput_msg_per_min} unit="" decimals={0} />
                        </span>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: LOGS
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              {(["tutum-app", "tutum-data", "all"] as const).map(ns => (
                <button key={ns} onClick={() => setLogNs(ns)}
                        className={`px-3 py-1 rounded-lg text-xs border transition ${
                          logNs === ns ? "border-blue-400/50 bg-blue-400/10 text-blue-400" : "border-white/[0.08] text-white/40 hover:text-white/60"
                        }`}>{ns}</button>
              ))}
              <div className="w-px bg-white/10" />
              {(["ALL", "INFO", "WARN", "ERROR"] as const).map(lv => (
                <button key={lv} onClick={() => setLogLevel(lv)}
                        className={`px-3 py-1 rounded-lg text-xs border transition ${
                          logLevel === lv ? "border-blue-400/50 bg-blue-400/10 text-blue-400" : "border-white/[0.08] text-white/40 hover:text-white/60"
                        }`}>{lv}</button>
              ))}
              <input value={logPod} onChange={e => setLogPod(e.target.value)} placeholder="파드명 필터..."
                     className="px-3 py-1 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-white/70 outline-none placeholder-white/20 w-40" />
            </div>

            <Card className="p-0 overflow-hidden">
              <div ref={logRef} className="h-[60vh] overflow-y-auto font-mono text-[11px] leading-5">
                {loadingLogs ? (
                  <div className="p-4 space-y-2">{[...Array(12)].map((_, i) => <Skel key={i} h="h-4" />)}</div>
                ) : filteredLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-white/20">로그 없음</div>
                ) : (
                  filteredLogs.map((log, i) => (
                    <div key={i} onClick={() => setLogPod(log.pod)}
                         className="flex items-start gap-3 px-4 py-1 border-b border-white/[0.03] hover:bg-white/[0.025] transition cursor-pointer">
                      <span className="text-white/25 shrink-0 w-16">{log.time}</span>
                      <LogLevelBadge level={log.level} />
                      <span className="text-white/25 shrink-0 hidden lg:inline w-28 truncate">{log.pod}</span>
                      <span className="text-white/60 break-all">{log.msg}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="px-4 py-2 border-t border-white/[0.06] text-xs text-white/30">
                {filteredLogs.length}개 · 10초 자동갱신
              </div>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: TRACES
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "traces" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">tutum-backend 서비스 · 최근 1시간 · 50ms 이상 · 60초 자동갱신</p>
              <a href={`${GRAFANA}/explore`} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-blue-400 hover:underline">Grafana Tempo →</a>
            </div>

            <Card className="p-0 overflow-hidden">
              {loadingTraces ? (
                <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skel key={i} h="h-8" />)}</div>
              ) : traces.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-white/20 gap-2">
                  <span className="text-3xl">∿</span>
                  <p className="text-sm">트레이스 없음</p>
                  <p className="text-xs text-white/15">OTel이 방금 활성화됐습니다. 요청 후 잠시 기다려 주세요.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/30 text-left border-b border-white/[0.06] bg-white/[0.02]">
                        {["Duration", "엔드포인트", "Trace ID", "시각"].map(h => (
                          <th key={h} className="px-4 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map(t => {
                        const dColor = t.durationMs > 500 ? C.red : t.durationMs > 200 ? C.amber : C.emerald;
                        const ts = new Date(t.startTimeMs).toLocaleTimeString("ko-KR", { hour12: false });
                        return (
                          <tr key={t.traceID} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition">
                            <td className="px-4 py-2">
                              <span className="font-mono font-bold text-sm" style={{ color: dColor }}>
                                {t.durationMs}ms
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono text-white/70 max-w-[300px] truncate">{t.rootTraceName}</td>
                            <td className="px-4 py-2">
                              <a href={t.grafana_url} target="_blank" rel="noopener noreferrer"
                                 className="font-mono text-blue-400 hover:underline truncate block max-w-[140px]">
                                {t.traceID.slice(0, 16)}…
                              </a>
                            </td>
                            <td className="px-4 py-2 text-white/30 font-mono">{ts}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: AI
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "ai" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Cluster diagnosis */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <SectionTitle>클러스터 AI 진단</SectionTitle>
                  <button onClick={async () => {
                    setLoadingDiag(true);
                    try {
                      const r = await fetch(`${API_BASE}/api/v1/admin/diagnose`);
                      if (r.ok) { const d = await r.json(); setDiagnosis(d.diagnosis); }
                    } catch {} finally { setLoadingDiag(false); }
                  }} disabled={loadingDiag}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                    {loadingDiag ? "분석 중…" : "✦ 진단 실행"}
                  </button>
                </div>

                {!diagnosis && !loadingDiag && (
                  <Card className="text-center py-10 text-white/20 text-sm">진단 실행 버튼을 눌러주세요</Card>
                )}
                {loadingDiag && <Card><Skel h="h-40" /></Card>}
                {diagnosis && !loadingDiag && (() => {
                  const c = SevColors(diagnosis.severity);
                  return (
                    <Card className={`${c.bg} ${c.border}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                        <span className={`text-sm font-semibold ${c.text}`}>{diagnosis.severity}</span>
                      </div>
                      <p className="text-white/80 text-sm mb-4">{diagnosis.summary}</p>
                      {diagnosis.issues.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {diagnosis.issues.map((iss, i) => (
                            <div key={i} className="bg-black/20 rounded-lg p-2">
                              <p className={`text-xs font-semibold ${iss.level === "ERROR" ? "text-red-400" : "text-amber-400"}`}>{iss.title}</p>
                              <p className="text-xs text-white/50 mt-0.5">{iss.detail}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {diagnosis.recommendations.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-white/30 mb-1">권장 조치</p>
                          {diagnosis.recommendations.map((r, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                r.priority === "HIGH" ? "bg-red-500/20 text-red-400" : r.priority === "MEDIUM" ? "bg-amber-500/20 text-amber-400" : "bg-slate-500/20 text-slate-400"
                              }`}>{r.priority}</span>
                              <span className="text-white/60">{r.action}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })()}
              </div>

              {/* Pipeline diagnosis */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <SectionTitle>파이프라인 AI 진단</SectionTitle>
                  <button onClick={async () => {
                    setLoadingPDiag(true);
                    try {
                      const r = await fetch(`${API_BASE}/api/v1/admin/pipeline-diagnose`);
                      if (r.ok) { const d = await r.json(); setPipelineDiag(d.diagnosis); }
                    } catch {} finally { setLoadingPDiag(false); }
                  }} disabled={loadingPDiag}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-400/30 bg-violet-400/10 text-violet-400 hover:bg-violet-400/20 transition disabled:opacity-50">
                    {loadingPDiag ? "분석 중…" : "✦ 진단 실행"}
                  </button>
                </div>

                {!pipelineDiag && !loadingPDiag && (
                  <Card className="text-center py-10 text-white/20 text-sm">진단 실행 버튼을 눌러주세요</Card>
                )}
                {loadingPDiag && <Card><Skel h="h-60" /></Card>}
                {pipelineDiag && !loadingPDiag && (() => {
                  const c = SevColors(pipelineDiag.overall);
                  return (
                    <div className="space-y-3">
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className={`text-xs font-semibold ${c.text}`}>전체: {pipelineDiag.overall}</span>
                      </div>
                      {(pipelineDiag.components || []).map(comp => {
                        const cc = comp.status === "ERROR"
                          ? SevColors("CRITICAL")
                          : comp.status === "WARN" ? SevColors("WARN") : SevColors("OK");
                        const meta = WORKER_META[comp.name];
                        return (
                          <Card key={comp.name} className={`${cc.bg} ${cc.border}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span>{meta?.icon ?? "⚙"}</span>
                                <span className="text-sm font-semibold">{comp.label || comp.name}</span>
                              </div>
                              <StatusBadge status={comp.status} />
                            </div>
                            <p className="text-xs text-white/60 mb-2">{comp.summary}</p>
                            {comp.issues.length > 0 && (
                              <div className="space-y-1">
                                {comp.issues.map((iss, i) => (
                                  <p key={i} className="text-xs text-amber-400">⚠ {iss.title}: {iss.detail}</p>
                                ))}
                              </div>
                            )}
                            {comp.actions.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {comp.actions.map((a, i) => (
                                  <p key={i} className="text-xs text-white/40">→ {a.action}</p>
                                ))}
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
