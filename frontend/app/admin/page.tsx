"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeInfo     = { name: string; role: string; status: string; cpu_percent: number; memory_percent: number; ip: string };
type PodInfo      = { name: string; namespace: string; status: string; restarts: number; node: string; age: string; ready: string };
type LogEntry     = { time: string; timestamp: number; level: string; namespace: string; pod: string; msg: string };
type DiagIssue    = { level: "WARN" | "ERROR"; title: string; detail: string };
type DiagRec      = { priority: "HIGH" | "MEDIUM" | "LOW"; action: string };
type Diagnosis    = { severity: "OK" | "WARN" | "CRITICAL"; summary: string; issues: DiagIssue[]; recommendations: DiagRec[] };
type WorkerStatus = { status: string; restarts: number; age: string; running: boolean };
type PipelineData = {
  workers: Record<string, WorkerStatus>;
  mongodb: { news_total: number; news_last_1h: number; available: boolean };
  elasticsearch: { news_docs: number; available: boolean };
  recent_logs: Record<string, string[]>;
};
type PipelineComponent = {
  name: string; label: string; status: "OK" | "WARN" | "ERROR";
  summary: string;
  issues: { title: string; detail: string }[];
  actions: { priority: "HIGH" | "MEDIUM" | "LOW"; action: string }[];
};
type PipelineDiagnosis = { overall: "OK" | "WARN" | "CRITICAL"; components: PipelineComponent[] };

// ─── Static meta ──────────────────────────────────────────────────────────────
const WORKER_META: Record<string, { label: string; desc: string; icon: string; color: string }> = {
  "news-producer":    { label: "뉴스 수집",     desc: "Einfomax → Kafka",        icon: "📡", color: "#60a5fa" },
  "news-consumer":    { label: "MongoDB 저장",  desc: "Kafka → MongoDB",         icon: "🗄️", color: "#34d399" },
  "elastic-consumer": { label: "ES 인덱싱",     desc: "Kafka → Elasticsearch",   icon: "🔍", color: "#a78bfa" },
};

// ─── Sub Components ───────────────────────────────────────────────────────────
function GaugeBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(value, 100);
  const bar = pct > 85 ? "#ef4444" : pct > 65 ? "#f59e0b" : color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: bar }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: bar }}>{value}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Running:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Ready:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    OK:       "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Pending:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
    WARN:     "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Failed:   "bg-red-500/20 text-red-400 border-red-500/30",
    Error:    "bg-red-500/20 text-red-400 border-red-500/30",
    ERROR:    "bg-red-500/20 text-red-400 border-red-500/30",
    Stopped:  "bg-slate-500/20 text-slate-400 border-slate-500/30",
    Unknown:  "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"}`}>
      {status}
    </span>
  );
}

function LogLevel({ level }: { level: string }) {
  const map: Record<string, string> = {
    INFO: "text-sky-400", WARN: "text-amber-400", ERROR: "text-red-400", DEBUG: "text-slate-500",
  };
  return <span className={`font-mono text-xs font-bold w-10 ${map[level] ?? "text-slate-400"}`}>{level}</span>;
}

function Skel({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-white/[0.06] rounded-md animate-pulse`} />;
}

function SevColors(sev: "OK" | "WARN" | "CRITICAL") {
  return sev === "CRITICAL"
    ? { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", dot: "bg-red-400" }
    : sev === "WARN"
    ? { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", dot: "bg-amber-400" }
    : { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", dot: "bg-emerald-400" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"pods" | "pipeline" | "logs" | "ai">("pods");

  // Cluster
  const [nodes, setNodes]             = useState<NodeInfo[]>([]);
  const [pods, setPods]               = useState<PodInfo[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [loadingPods, setLoadingPods]   = useState(true);
  const [lastUpdated, setLastUpdated]   = useState("");

  // Pods tab
  const [nsFilter, setNsFilter] = useState("all");

  // Logs
  const [logs, setLogs]                   = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs]     = useState(true);
  const [logNamespace, setLogNamespace]   = useState("tutum-app");
  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logPodFilter, setLogPodFilter]   = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Pipeline
  const [pipeline, setPipeline]             = useState<PipelineData | null>(null);
  const [loadingPipeline, setLoadingPipeline] = useState(true);

  // AI
  const [diagnosis, setDiagnosis]         = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading]     = useState(false);
  const [diagError, setDiagError]         = useState<string | null>(null);
  const [diagAt, setDiagAt]               = useState("");
  const [pipelineDiag, setPipelineDiag]           = useState<PipelineDiagnosis | null>(null);
  const [pipelineDiagLoading, setPipelineDiagLoading] = useState(false);
  const [pipelineDiagError, setPipelineDiagError]   = useState<string | null>(null);
  const [pipelineDiagAt, setPipelineDiagAt]         = useState("");

  // ── Fetchers
  const fetchNodes = async () => {
    try { const r = await fetch(`${API_BASE}/api/v1/admin/nodes`); if (r.ok) { const d = await r.json(); setNodes(d.nodes ?? []); } }
    catch {} finally { setLoadingNodes(false); }
  };
  const fetchPods = async () => {
    try { const r = await fetch(`${API_BASE}/api/v1/admin/pods`); if (r.ok) { const d = await r.json(); setPods(d.pods ?? []); } }
    catch {} finally { setLoadingPods(false); }
  };
  const fetchPipeline = async () => {
    try { const r = await fetch(`${API_BASE}/api/v1/admin/pipeline`); if (r.ok) { const d = await r.json(); setPipeline(d); } }
    catch {} finally { setLoadingPipeline(false); }
  };
  const fetchLogs = async (ns: string) => {
    try { const r = await fetch(`${API_BASE}/api/v1/admin/logs?namespace=${ns}&limit=100`); if (r.ok) { const d = await r.json(); setLogs(d.logs ?? []); } }
    catch {} finally { setLoadingLogs(false); }
  };
  const runDiagnose = async () => {
    setDiagLoading(true); setDiagnosis(null); setDiagError(null);
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/diagnose`);
      if (r.ok) { const d = await r.json(); setDiagnosis(d.diagnosis); setDiagAt(new Date().toTimeString().slice(0, 8)); }
      else setDiagError("AI 진단 요청 실패");
    } catch { setDiagError("네트워크 오류"); } finally { setDiagLoading(false); }
  };
  const runPipelineDiagnose = async () => {
    setPipelineDiagLoading(true); setPipelineDiag(null); setPipelineDiagError(null);
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pipeline-diagnose`);
      if (r.ok) { const d = await r.json(); setPipelineDiag(d.diagnosis); setPipelineDiagAt(new Date().toTimeString().slice(0, 8)); }
      else setPipelineDiagError("파이프라인 AI 분석 실패");
    } catch { setPipelineDiagError("네트워크 오류"); } finally { setPipelineDiagLoading(false); }
  };

  // ── Polling
  useEffect(() => {
    fetchNodes(); fetchPods(); fetchPipeline();
    const t = setInterval(() => { fetchNodes(); fetchPods(); fetchPipeline(); setLastUpdated(new Date().toTimeString().slice(0, 8)); }, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLoadingLogs(true);
    fetchLogs(logNamespace);
    const t = setInterval(() => fetchLogs(logNamespace), 10000);
    return () => clearInterval(t);
  }, [logNamespace]);

  // ── Derived
  const runningPods  = pods.filter(p => p.status === "Running").length;
  const totalRestarts = pods.reduce((s, p) => s + p.restarts, 0);
  const avgCpu = nodes.length ? Math.round(nodes.reduce((s, n) => s + n.cpu_percent, 0) / nodes.length) : 0;
  const avgMem = nodes.length ? Math.round(nodes.reduce((s, n) => s + n.memory_percent, 0) / nodes.length) : 0;
  const namespaces = ["all", ...Array.from(new Set(pods.map(p => p.namespace)))];
  const filteredPods = nsFilter === "all" ? pods : pods.filter(p => p.namespace === nsFilter);
  const podGroups = {
    Running: pods.filter(p => p.status === "Running").length,
    Pending: pods.filter(p => ["Pending", "ContainerCreating"].includes(p.status)).length,
    Failed:  pods.filter(p => ["Failed", "Error", "CrashLoopBackOff", "OOMKilled", "ImagePullBackOff"].includes(p.status)).length,
    Evicted: pods.filter(p => p.status === "Evicted").length,
  };
  const filteredLogs = logs.filter(l => {
    if (logLevelFilter !== "ALL" && l.level !== logLevelFilter) return false;
    if (logPodFilter && !l.pod.includes(logPodFilter)) return false;
    return true;
  });

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white font-sans">

      {/* ── Header ── */}
      <header className="border-b border-white/5 bg-[#0d1220]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold">T</div>
            <span className="font-semibold text-sm tracking-wide">Tutum Admin</span>
            <span className="text-white/20">|</span>
            <span className="text-white/40 text-xs">K8s Cluster Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-xs text-white/50">Live</span></span>
            {lastUpdated && <span className="text-xs text-white/30 font-mono">updated {lastUpdated}</span>}
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* ══ 클러스터 개요 (항상 표시) ══ */}
        <section className="space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: "Nodes", icon: "⬡", color: "#34d399",
                value: loadingNodes ? "..." : `${nodes.length}`,
                sub: nodes.length > 0 && nodes.every(n => n.status === "Ready") ? "All Ready" : nodes.length > 0 ? "Check Status" : "Loading...",
              },
              {
                label: "Running Pods", icon: "◉", color: "#60a5fa",
                value: loadingPods ? "..." : `${runningPods}/${pods.length}`,
                sub: loadingPods ? "" : `Restarts: ${totalRestarts}`,
              },
              {
                label: "CPU avg", icon: "⚙", color: avgCpu > 85 ? "#ef4444" : avgCpu > 65 ? "#f59e0b" : "#34d399",
                value: loadingNodes ? "..." : `${avgCpu}%`,
                sub: "across nodes",
              },
              {
                label: "MEM avg", icon: "▣", color: avgMem > 85 ? "#ef4444" : avgMem > 65 ? "#f59e0b" : "#a78bfa",
                value: loadingNodes ? "..." : `${avgMem}%`,
                sub: "across nodes",
              },
            ].map(c => (
              <div key={c.label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-white/40 text-xs font-medium uppercase tracking-wider">{c.label}</span>
                  <span className="text-base" style={{ color: c.color }}>{c.icon}</span>
                </div>
                <div className="text-2xl font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
                <div className="text-xs text-white/30 mt-1">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Node grid */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white/60 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              클러스터 노드
              {!loadingNodes && <span className="text-white/30 font-normal text-xs">({nodes.length}개)</span>}
            </h2>
            {loadingNodes ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white/[0.03] border border-white/5 rounded-lg p-4 space-y-3">
                    <Skel w="w-28" h="h-4" /><Skel h="h-2" /><Skel h="h-2" />
                  </div>
                ))}
              </div>
            ) : nodes.length === 0 ? (
              <div className="text-xs text-red-400/60 py-4 text-center">노드 데이터를 가져올 수 없습니다</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {nodes.map(n => (
                  <div key={n.name} className="bg-white/[0.03] border border-white/5 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm font-semibold">{n.name}</div>
                        <div className="text-xs text-white/30 mt-0.5">
                          {n.ip} · <span className={n.role === "worker" ? "text-sky-400/70" : "text-violet-400/70"}>{n.role}</span>
                        </div>
                      </div>
                      <StatusBadge status={n.status} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-white/40">CPU</div>
                      <GaugeBar value={n.cpu_percent} color="#60a5fa" />
                      <div className="text-xs text-white/40 mt-1">Memory</div>
                      <GaugeBar value={n.memory_percent} color="#a78bfa" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-white/[0.03] border border-white/5 rounded-xl p-1 w-fit">
          {([
            { id: "pods",     label: "파드 분석" },
            { id: "pipeline", label: "파이프라인" },
            { id: "logs",     label: "로그" },
            { id: "ai",       label: "✦ AI 분석" },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══ 파드 분석 탭 ══ */}
        {activeTab === "pods" && (
          <div className="space-y-4">

            {/* Status group cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Running", count: podGroups.Running, color: "#34d399", bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
                { label: "Pending", count: podGroups.Pending, color: "#f59e0b", bg: "bg-amber-500/8",   border: "border-amber-500/20" },
                { label: "Failed",  count: podGroups.Failed,  color: "#f87171", bg: "bg-red-500/8",     border: "border-red-500/20" },
                { label: "Evicted", count: podGroups.Evicted, color: "#94a3b8", bg: "bg-slate-500/8",   border: "border-slate-500/20" },
              ].map(g => (
                <div key={g.label} className={`${g.bg} border ${g.border} rounded-xl p-4`} style={{ backgroundColor: `color-mix(in srgb, ${g.color} 8%, transparent)` }}>
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-2">{g.label}</div>
                  <div className="text-3xl font-bold font-mono" style={{ color: g.color }}>{loadingPods ? "..." : g.count}</div>
                  <div className="text-xs text-white/20 mt-1">pods</div>
                </div>
              ))}
            </div>

            {/* Pod table */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white/60">
                  Pods {!loadingPods && <span className="text-white/30 font-normal">({filteredPods.length})</span>}
                </h2>
                <div className="flex gap-1">
                  {namespaces.map(ns => (
                    <button
                      key={ns}
                      onClick={() => setNsFilter(ns)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        nsFilter === ns ? "bg-indigo-600 text-white" : "text-white/40 hover:text-white/70 bg-white/[0.03]"
                      }`}
                    >
                      {ns}
                    </button>
                  ))}
                </div>
              </div>
              {loadingPods ? (
                <div className="p-5 space-y-2">{[1,2,3,4,5].map(i => <Skel key={i} h="h-10" />)}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {["Name", "Namespace", "Status", "Ready", "Restarts", "Node", "Age"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-medium text-white/30 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPods.map((pod, i) => {
                      const bad  = ["Failed", "Error", "CrashLoopBackOff", "OOMKilled", "ImagePullBackOff", "Evicted"].includes(pod.status);
                      const warn = pod.restarts > 5;
                      return (
                        <tr
                          key={pod.name}
                          className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${
                            bad ? "bg-red-500/5" : warn ? "bg-amber-500/5" : i % 2 === 1 ? "bg-white/[0.01]" : ""
                          }`}
                        >
                          <td className="px-5 py-3 font-mono text-xs text-white/80">{pod.name}</td>
                          <td className="px-5 py-3">
                            <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{pod.namespace}</span>
                          </td>
                          <td className="px-5 py-3"><StatusBadge status={pod.status} /></td>
                          <td className="px-5 py-3 font-mono text-xs text-white/50">{pod.ready}</td>
                          <td className="px-5 py-3">
                            <span className={`font-mono text-xs font-semibold ${pod.restarts > 10 ? "text-red-400" : pod.restarts > 0 ? "text-amber-400" : "text-white/40"}`}>
                              {pod.restarts}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-white/50 font-mono">{pod.node}</td>
                          <td className="px-5 py-3 text-xs text-white/40">{pod.age}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ══ 파이프라인 탭 ══ */}
        {activeTab === "pipeline" && (
          <div className="space-y-4">

            {/* Flow header */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/60 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                뉴스 파이프라인 · 3대 구성요소
              </h2>
              {!loadingPipeline && <span className="text-xs text-white/30">30초 자동 갱신</span>}
            </div>

            {/* Worker flow cards */}
            <div className="flex flex-col md:flex-row items-stretch gap-3">
              {(["news-producer", "news-consumer", "elastic-consumer"] as const).map((worker, idx) => {
                const meta = WORKER_META[worker];
                const w    = pipeline?.workers[worker];
                const running = w?.running ?? false;
                const stopped = w?.status === "Stopped";
                const border  = !w ? "border-white/5" : running ? "border-emerald-500/20" : stopped ? "border-white/8" : "border-red-500/20";
                const bg      = !w ? "" : running ? "bg-emerald-500/5" : stopped ? "bg-white/[0.02]" : "bg-red-500/5";
                const stColor = !w ? "text-slate-400" : running ? "text-emerald-400" : stopped ? "text-slate-400" : "text-red-400";

                return (
                  <div key={worker} className="flex md:contents">
                    <div className={`flex-1 bg-white/[0.03] border ${border} ${bg} rounded-xl p-5 flex flex-col gap-3`}>
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-2xl mb-1">{meta.icon}</div>
                          <div className="text-sm font-semibold text-white/80">{meta.label}</div>
                          <div className="text-xs text-white/30 mt-0.5 font-mono">{meta.desc}</div>
                        </div>
                        {loadingPipeline ? (
                          <Skel w="w-16" h="h-5" />
                        ) : (
                          <span className={`text-xs font-mono font-bold ${stColor}`}>{w?.status ?? "Unknown"}</span>
                        )}
                      </div>

                      {/* Stats */}
                      {!loadingPipeline && w && (
                        <div className="space-y-1.5 text-xs border-t border-white/5 pt-3">
                          <div className="flex justify-between text-white/40">
                            <span>재시작</span>
                            <span className={`font-mono ${w.restarts > 0 ? "text-amber-400" : "text-white/60"}`}>{w.restarts}회</span>
                          </div>
                          <div className="flex justify-between text-white/40">
                            <span>가동시간</span>
                            <span className="font-mono text-white/60">{w.age}</span>
                          </div>
                        </div>
                      )}

                      {/* Recent log snippet */}
                      {!loadingPipeline && (
                        <div>
                          {pipeline?.recent_logs[worker]?.length ? (
                            <>
                              <div className="text-xs text-white/25 mb-1.5">최근 로그</div>
                              <div className="bg-[#080b14] rounded-lg p-2.5 space-y-1 max-h-[72px] overflow-hidden">
                                {pipeline.recent_logs[worker].slice(0, 3).map((l, i) => (
                                  <div key={i} className="text-[11px] font-mono text-white/35 truncate">{l}</div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-white/20 text-center py-2 bg-white/[0.02] rounded-lg">
                              {stopped ? "비활성 (replicas=0)" : "최근 로그 없음"}
                            </div>
                          )}
                        </div>
                      )}

                      {loadingPipeline && (
                        <div className="space-y-2">
                          <Skel h="h-3" /><Skel h="h-3" w="w-3/4" />
                        </div>
                      )}
                    </div>

                    {/* Arrow (between cards, not after last) */}
                    {idx < 2 && (
                      <div className="hidden md:flex items-center px-1 text-white/20 text-xl self-center">→</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Data stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* MongoDB */}
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white/60 mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  MongoDB · news 컬렉션
                </h3>
                {loadingPipeline ? (
                  <div className="space-y-3"><Skel w="w-32" h="h-8" /><Skel w="w-24" h="h-4" /></div>
                ) : pipeline?.mongodb.available ? (
                  <div className="flex gap-8 items-end">
                    <div>
                      <div className="text-3xl font-bold font-mono text-emerald-400">{pipeline.mongodb.news_total.toLocaleString()}</div>
                      <div className="text-xs text-white/30 mt-1">전체 문서</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold font-mono text-sky-400">+{pipeline.mongodb.news_last_1h}</div>
                      <div className="text-xs text-white/30 mt-1">최근 1시간</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-white/20 py-4">MongoDB 연결 불가</div>
                )}
              </div>

              {/* Elasticsearch */}
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white/60 mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  Elasticsearch · news 인덱스
                </h3>
                {loadingPipeline ? (
                  <div className="space-y-3"><Skel w="w-32" h="h-8" /><Skel w="w-24" h="h-4" /></div>
                ) : pipeline?.elasticsearch.available ? (
                  <div>
                    <div className="text-3xl font-bold font-mono text-violet-400">{pipeline.elasticsearch.news_docs.toLocaleString()}</div>
                    <div className="text-xs text-white/30 mt-1">인덱싱된 문서</div>
                    {pipeline.mongodb.available && pipeline.mongodb.news_total > 0 && (
                      <div className="text-xs text-white/30 mt-2">
                        MongoDB 대비 {Math.round(pipeline.elasticsearch.news_docs / pipeline.mongodb.news_total * 100)}% 인덱싱됨
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-white/20 py-4">
                    Elasticsearch 연결 불가
                    <div className="text-white/15 mt-1">elastic-consumer 비활성 상태</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══ 로그 탭 ══ */}
        {activeTab === "logs" && (
          <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-3 justify-between">
              <h2 className="text-sm font-semibold text-white/60 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Log Stream
                <span className="text-white/30 font-normal text-xs">(Loki · 10s)</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Namespace */}
                <div className="flex gap-1">
                  {["tutum-app", "tutum-data", "all"].map(ns => (
                    <button key={ns} onClick={() => setLogNamespace(ns)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${logNamespace === ns ? "bg-indigo-600 text-white" : "text-white/40 hover:text-white/70 bg-white/[0.03]"}`}>
                      {ns}
                    </button>
                  ))}
                </div>
                {/* Level */}
                <div className="flex gap-1">
                  {(["ALL", "INFO", "WARN", "ERROR"] as const).map(lv => (
                    <button key={lv} onClick={() => setLogLevelFilter(lv)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        logLevelFilter === lv
                          ? lv === "ERROR" ? "bg-red-600 text-white"
                          : lv === "WARN"  ? "bg-amber-600 text-white"
                          : "bg-indigo-600 text-white"
                          : "text-white/40 hover:text-white/70 bg-white/[0.03]"
                      }`}>
                      {lv}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-white/30 font-mono">{filteredLogs.length} entries</span>
              </div>
            </div>

            {/* Log pod filter pill */}
            {logPodFilter && (
              <div className="px-5 py-2 bg-white/[0.02] border-b border-white/5 flex items-center gap-2 text-xs">
                <span className="text-white/30">Pod 필터:</span>
                <span className="text-violet-300 font-mono">{logPodFilter}</span>
                <button onClick={() => setLogPodFilter("")} className="text-white/30 hover:text-white/60 ml-1">✕</button>
              </div>
            )}

            <div ref={logRef} className="h-[520px] overflow-y-auto font-mono text-xs p-4 space-y-0.5 bg-[#080b14]">
              {loadingLogs ? (
                <div className="flex items-center justify-center h-full text-white/30">로그 로딩 중...</div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-1.5 text-white/20">
                  <span>로그 없음</span>
                  <span className="text-xs">(최근 10분{logLevelFilter !== "ALL" ? ` · ${logLevelFilter}` : ""})</span>
                </div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 hover:bg-white/[0.02] px-2 py-0.5 rounded transition-colors cursor-pointer"
                    onClick={() => setLogPodFilter(logPodFilter === log.pod ? "" : log.pod)}
                  >
                    <span className="text-white/25 flex-shrink-0 w-16">{log.time}</span>
                    <LogLevel level={log.level} />
                    <span className="text-indigo-400/60 flex-shrink-0 w-24 truncate">{log.namespace}</span>
                    <span className={`flex-shrink-0 w-40 truncate ${logPodFilter === log.pod ? "text-violet-300" : "text-violet-400/70"}`}>{log.pod}</span>
                    <span className={`flex-1 ${log.level === "ERROR" ? "text-red-300" : log.level === "WARN" ? "text-amber-300" : "text-white/60"}`}>
                      {log.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ══ AI 분석 탭 ══ */}
        {activeTab === "ai" && (
          <div className="space-y-4">

            {/* 클러스터 진단 */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    ✦ 클러스터 AI 진단
                    <span className="text-white/30 text-xs font-normal">Bedrock Claude</span>
                  </h2>
                  <p className="text-xs text-white/30 mt-1">노드/파드 전체 상태를 AI로 분석 — 이슈 및 권장 조치 제안</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {diagAt && <span className="text-xs text-white/30 font-mono">{diagAt}</span>}
                  <button
                    onClick={runDiagnose} disabled={diagLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {diagLoading
                      ? <><span className="w-3 h-3 border border-violet-400/50 border-t-violet-300 rounded-full animate-spin" />분석 중...</>
                      : <>✦ 진단 실행</>}
                  </button>
                </div>
              </div>

              {!diagnosis && !diagLoading && !diagError && (
                <div className="text-center py-10 text-white/20 text-sm">버튼을 눌러 클러스터 상태를 AI로 진단합니다</div>
              )}
              {diagError && (
                <div className="text-xs text-red-400/70 bg-red-500/5 border border-red-500/10 rounded-lg px-4 py-3">{diagError}</div>
              )}

              {diagnosis && !diagLoading && (() => {
                const c = SevColors(diagnosis.severity);
                return (
                  <div className="space-y-4">
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${c.bg} border ${c.border}`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                      <span className={`text-sm font-bold ${c.text}`}>{diagnosis.severity}</span>
                      <span className="text-sm text-white/70">{diagnosis.summary}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {diagnosis.issues.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 font-bold uppercase tracking-widest mb-2">발견된 이슈</div>
                          <div className="space-y-2">
                            {diagnosis.issues.map((issue, i) => (
                              <div key={i} className={`rounded-lg px-3 py-2.5 border ${issue.level === "ERROR" ? "bg-red-500/5 border-red-500/15" : "bg-amber-500/5 border-amber-500/15"}`}>
                                <div className={`text-xs font-semibold mb-0.5 ${issue.level === "ERROR" ? "text-red-400" : "text-amber-400"}`}>
                                  {issue.level === "ERROR" ? "● " : "◆ "}{issue.title}
                                </div>
                                <div className="text-xs text-white/50">{issue.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {diagnosis.recommendations.length > 0 && (
                        <div>
                          <div className="text-xs text-white/40 font-bold uppercase tracking-widest mb-2">권장 조치</div>
                          <div className="space-y-2">
                            {diagnosis.recommendations.map((rec, i) => {
                              const p = rec.priority === "HIGH"   ? "text-red-400 bg-red-500/5 border-red-500/15"
                                       : rec.priority === "MEDIUM" ? "text-amber-400 bg-amber-500/5 border-amber-500/15"
                                       : "text-sky-400 bg-sky-500/5 border-sky-500/15";
                              return (
                                <div key={i} className={`rounded-lg px-3 py-2.5 border ${p}`}>
                                  <span className="text-xs font-mono opacity-60 mr-2">[{rec.priority}]</span>
                                  <span className="text-xs text-white/60">{rec.action}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {diagnosis.issues.length === 0 && (
                        <div className="col-span-2 text-xs text-emerald-400/70 text-center py-2">발견된 이슈 없음 — 클러스터 정상 운영 중</div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 파이프라인 AI 분석 */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    ⟳ 파이프라인 AI 분석
                    <span className="text-white/30 text-xs font-normal">3대 구성요소 개별 분석</span>
                  </h2>
                  <p className="text-xs text-white/30 mt-1">뉴스 수집 → MongoDB 저장 → ES 인덱싱 각 단계를 Bedrock이 진단합니다</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {pipelineDiagAt && <span className="text-xs text-white/30 font-mono">{pipelineDiagAt}</span>}
                  <button
                    onClick={runPipelineDiagnose} disabled={pipelineDiagLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {pipelineDiagLoading
                      ? <><span className="w-3 h-3 border border-emerald-400/50 border-t-emerald-300 rounded-full animate-spin" />분석 중...</>
                      : <>⟳ 파이프라인 분석</>}
                  </button>
                </div>
              </div>

              {!pipelineDiag && !pipelineDiagLoading && !pipelineDiagError && (
                <div className="text-center py-10 text-white/20 text-sm">버튼을 눌러 파이프라인 3대 구성요소를 AI로 분석합니다</div>
              )}
              {pipelineDiagError && (
                <div className="text-xs text-red-400/70 bg-red-500/5 border border-red-500/10 rounded-lg px-4 py-3">{pipelineDiagError}</div>
              )}

              {pipelineDiag && !pipelineDiagLoading && (
                <div className="space-y-3">
                  {/* Overall */}
                  {(() => {
                    const c = SevColors(pipelineDiag.overall);
                    return (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${c.bg} border ${c.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className={`text-xs font-bold ${c.text}`}>전체: {pipelineDiag.overall}</span>
                      </div>
                    );
                  })()}

                  {/* Per-component cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {pipelineDiag.components.map(comp => {
                      const meta = WORKER_META[comp.name] ?? { icon: "◉", label: comp.label, color: "#94a3b8" };
                      const c = comp.status === "ERROR" ? { border: "border-red-500/20", bg: "bg-red-500/5", text: "text-red-400" }
                              : comp.status === "WARN"  ? { border: "border-amber-500/20", bg: "bg-amber-500/5", text: "text-amber-400" }
                              : { border: "border-emerald-500/20", bg: "bg-emerald-500/5", text: "text-emerald-400" };
                      return (
                        <div key={comp.name} className={`border ${c.border} ${c.bg} rounded-xl p-4 space-y-3`}>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-xl mb-1">{meta.icon}</div>
                              <div className="text-sm font-semibold text-white/80">{comp.label}</div>
                            </div>
                            <span className={`text-xs font-bold ${c.text}`}>{comp.status}</span>
                          </div>
                          <div className="text-xs text-white/60">{comp.summary}</div>
                          {comp.issues.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[10px] text-white/30 uppercase tracking-wider font-bold">이슈</div>
                              {comp.issues.map((issue, i) => (
                                <div key={i} className="text-xs bg-black/20 rounded px-2 py-1.5">
                                  <div className="text-white/70 font-medium">{issue.title}</div>
                                  <div className="text-white/40 mt-0.5">{issue.detail}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {comp.actions.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] text-white/30 uppercase tracking-wider font-bold">조치</div>
                              {comp.actions.map((act, i) => (
                                <div key={i} className="text-xs text-white/50 flex gap-1.5">
                                  <span className={`font-mono text-[10px] flex-shrink-0 ${act.priority === "HIGH" ? "text-red-400" : act.priority === "MEDIUM" ? "text-amber-400" : "text-sky-400"}`}>
                                    [{act.priority}]
                                  </span>
                                  {act.action}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
