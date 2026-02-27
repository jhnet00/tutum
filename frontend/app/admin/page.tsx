"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeInfo = { name: string; role: string; status: string; cpu_percent: number; memory_percent: number; ip: string };
type PodInfo  = { name: string; namespace: string; status: string; restarts: number; node: string; age: string; ready: string };
type Metrics  = { rps: number[]; latency_p95: number[]; error_rate: number[]; kafka_lag: number[] };

// ─── Mock Logs (Loki 미연동, 시뮬레이션 유지) ─────────────────────────────────
const MOCK_LOGS = [
  { time: "07:18:42", level: "INFO", pod: "backend-6c8d7f-p9rs", msg: "GET /api/v1/market/prices 200 OK (45ms)" },
  { time: "07:18:41", level: "INFO", pod: "backend-6c8d7f-t3uv", msg: "WebSocket connected: user_id=u_8821" },
  { time: "07:18:40", level: "INFO", pod: "frontend-7d9f8b-xk2p", msg: "Page rendered: /portfolio (SSR 120ms)" },
  { time: "07:18:38", level: "WARN", pod: "kafka-0", msg: "Consumer lag detected on topic 'prices': lag=3" },
  { time: "07:18:35", level: "INFO", pod: "backend-6c8d7f-p9rs", msg: "POST /api/v1/auth/login 200 OK (88ms)" },
  { time: "07:18:33", level: "INFO", pod: "alloy-ds-xk2p", msg: "Metrics scraped: 142 series from tutum-app" },
  { time: "07:18:30", level: "ERROR", pod: "backend-6c8d7f-t3uv", msg: "Redis connection timeout (retry 1/3)" },
  { time: "07:18:28", level: "INFO", pod: "backend-6c8d7f-t3uv", msg: "Redis reconnected successfully" },
  { time: "07:18:25", level: "INFO", pod: "ingress-nginx-ctrl", msg: "200 GET / 0.012s" },
  { time: "07:18:22", level: "INFO", pod: "backend-6c8d7f-p9rs", msg: "GET /api/v1/portfolio 200 OK (62ms)" },
];

// ─── Sub Components ───────────────────────────────────────────────────────────
function MiniChart({ values, color, unit = "" }: { values: number[]; color: string; unit?: string }) {
  const max = Math.max(...values) * 1.2 || 1;
  const w = 180, h = 48;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  const area = `${pts} ${w},${h} 0,${h}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${color})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x={w} y={h - 4} textAnchor="end" fontSize="10" fill={color} fontWeight="600">
        {values[values.length - 1]}{unit}
      </text>
    </svg>
  );
}

function GaugeBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const barColor = pct > 85 ? "#ef4444" : pct > 65 ? "#f59e0b" : color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: barColor }}>{value}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Ready: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Failed: "bg-red-500/20 text-red-400 border-red-500/30",
    Error: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"}`}>
      {status}
    </span>
  );
}

function LogLevel({ level }: { level: string }) {
  const map: Record<string, string> = {
    INFO: "text-sky-400",
    WARN: "text-amber-400",
    ERROR: "text-red-400",
    DEBUG: "text-slate-500",
  };
  return <span className={`font-mono text-xs font-bold w-10 ${map[level] ?? "text-slate-400"}`}>{level}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "pods" | "logs" | "monitoring">("overview");
  const [nsFilter, setNsFilter] = useState("all");
  const [logs, setLogs] = useState(MOCK_LOGS);
  const logRef = useRef<HTMLDivElement>(null);

  // ── 실데이터 상태
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ rps: [], latency_p95: [], error_rate: [], kafka_lag: [] });
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [loadingPods, setLoadingPods] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchNodes = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/nodes`);
      if (res.ok) { const d = await res.json(); setNodes(d.nodes ?? []); }
    } catch { /* 네트워크 오류 시 이전 데이터 유지 */ }
    finally { setLoadingNodes(false); }
  };

  const fetchPods = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/pods`);
      if (res.ok) { const d = await res.json(); setPods(d.pods ?? []); }
    } catch { /* silent */ }
    finally { setLoadingPods(false); }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/metrics`);
      if (res.ok) { const d = await res.json(); setMetrics(d); }
    } catch { /* silent */ }
  };

  // 최초 로드 + 30초마다 폴링
  useEffect(() => {
    fetchNodes(); fetchPods(); fetchMetrics();
    const poll = setInterval(() => {
      fetchNodes(); fetchPods(); fetchMetrics();
      setLastUpdated(new Date().toTimeString().slice(0, 8));
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  // 로그 시뮬레이션 (Loki 미연동)
  useEffect(() => {
    const podNames = pods.length > 0
      ? pods.map((p) => p.name)
      : MOCK_LOGS.map((l) => l.pod);
    const interval = setInterval(() => {
      const newLog = {
        time: new Date().toTimeString().slice(0, 8),
        level: ["INFO", "INFO", "INFO", "WARN", "ERROR"][Math.floor(Math.random() * 5)],
        pod: podNames[Math.floor(Math.random() * podNames.length)],
        msg: [
          "GET /api/v1/market/prices 200 OK",
          "Metrics scraped successfully",
          "WebSocket heartbeat OK",
          "Cache hit: price:005930",
          "Consumer lag: prices=0",
          "WARN: slow query detected (>200ms)",
          "ERROR: upstream timeout, retrying...",
        ][Math.floor(Math.random() * 7)],
      };
      setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
    }, 3000);
    return () => clearInterval(interval);
  }, [pods]);

  const filteredPods = nsFilter === "all" ? pods : pods.filter((p) => p.namespace === nsFilter);
  const namespaces = ["all", ...Array.from(new Set(pods.map((p) => p.namespace)))];
  const runningPods = pods.filter((p) => p.status === "Running").length;
  const totalRestarts = pods.reduce((s, p) => s + p.restarts, 0);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white font-sans">
      {/* ── Header ── */}
      <header className="border-b border-white/5 bg-[#0d1220]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold">T</div>
            <span className="font-semibold text-sm tracking-wide">Tutum Admin</span>
            <span className="text-white/20 text-sm">|</span>
            <span className="text-white/40 text-xs">K8s Cluster Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/50">Live</span>
            </div>
            {lastUpdated && <span className="text-xs text-white/30 font-mono">updated {lastUpdated}</span>}
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Nodes", value: loadingNodes ? "..." : `${nodes.length}`, sub: nodes.every((n) => n.status === "Ready") ? "All Ready" : "Check Status", color: "#34d399", icon: "⬡" },
            { label: "Running Pods", value: loadingPods ? "..." : `${runningPods}/${pods.length}`, sub: "tutum-app + data", color: "#60a5fa", icon: "◉" },
            { label: "Total Restarts", value: loadingPods ? "..." : `${totalRestarts}`, sub: "현재 파드 기준", color: totalRestarts > 5 ? "#f59e0b" : "#34d399", icon: "↺" },
            { label: "Ingress IP", value: "192.168.0.240", sub: "MetalLB / Istio", color: "#a78bfa", icon: "⇄" },
          ].map((c) => (
            <div key={c.label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">{c.label}</span>
                <span className="text-lg" style={{ color: c.color }}>{c.icon}</span>
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
              <div className="text-xs text-white/30 mt-1">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-white/[0.03] border border-white/5 rounded-xl p-1 w-fit">
          {(["overview", "pods", "logs", "monitoring"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
                activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-white/40 hover:text-white/70"
              }`}
            >
              {tab === "overview" ? "📊 Overview" : tab === "pods" ? "🫛 Pods" : tab === "logs" ? "📋 Logs" : "📈 Monitoring"}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* Nodes */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white/70 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Nodes
              </h2>
              {loadingNodes ? (
                <div className="text-xs text-white/30 py-4 text-center">노드 정보 로딩 중...</div>
              ) : nodes.length === 0 ? (
                <div className="text-xs text-red-400/70 py-4 text-center">노드 데이터를 가져올 수 없습니다</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {nodes.map((n) => (
                    <div key={n.name} className="bg-white/[0.03] border border-white/5 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-sm font-semibold">{n.name}</div>
                          <div className="text-xs text-white/30">{n.ip} · {n.role}</div>
                        </div>
                        <StatusBadge status={n.status} />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-white/40 mb-0.5">
                          <span>CPU</span>
                        </div>
                        <GaugeBar value={n.cpu_percent} color="#60a5fa" />
                        <div className="flex justify-between text-xs text-white/40 mb-0.5 mt-2">
                          <span>Memory</span>
                        </div>
                        <GaugeBar value={n.memory_percent} color="#a78bfa" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metrics Charts (Mimir 실데이터) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "API Requests/s", values: metrics.rps, color: "#60a5fa", unit: "/s" },
                { label: "P95 Latency (ms)", values: metrics.latency_p95, color: "#a78bfa", unit: "ms" },
                { label: "Error Rate (%)", values: metrics.error_rate, color: "#f87171", unit: "%" },
                { label: "Kafka Lag", values: metrics.kafka_lag, color: "#34d399", unit: "" },
              ].map((m) => (
                <div key={m.label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-2">
                  <div className="text-[10px] text-white/40 font-bold uppercase tracking-widest">{m.label}</div>
                  {m.values.length > 0 ? (
                    <MiniChart values={m.values} color={m.color} unit={m.unit} />
                  ) : (
                    <div className="h-12 flex items-center justify-center text-xs text-white/20">데이터 없음</div>
                  )}
                </div>
              ))}
            </div>

            {/* Services Status */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white/70 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                Services
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { name: "frontend-svc", ns: "tutum-app", port: "80→3000", type: "ClusterIP", ok: true },
                  { name: "backend-svc", ns: "tutum-app", port: "8000", type: "ClusterIP", ok: true },
                  { name: "redis-svc", ns: "tutum-data", port: "6379", type: "ClusterIP", ok: true },
                  { name: "kafka-bootstrap", ns: "tutum-data", port: "9092", type: "ClusterIP", ok: true },
                  { name: "ingress-nginx", ns: "ingress-nginx", port: "80/443", type: "LoadBalancer", ok: true },
                  { name: "alloy", ns: "monitoring", port: "12345", type: "ClusterIP", ok: true },
                  { name: "elasticsearch", ns: "tutum-data", port: "9200", type: "ClusterIP", ok: true },
                  { name: "minio-api", ns: "tutum-storage", port: "9000", type: "ClusterIP", ok: false },
                ].map((s) => (
                  <div key={s.name} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-medium truncate">{s.name}</div>
                      <div className="text-xs text-white/30 truncate">{s.ns} · :{s.port}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Pods Tab ── */}
        {activeTab === "pods" && (
          <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/70">
                Pods {!loadingPods && <span className="text-white/30 font-normal">({pods.length})</span>}
              </h2>
              <div className="flex gap-1">
                {namespaces.map((ns) => (
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
              <div className="text-xs text-white/30 py-8 text-center">파드 목록 로딩 중...</div>
            ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {["Name", "Namespace", "Status", "Ready", "Restarts", "Node", "Age"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-white/30 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPods.map((pod, i) => (
                  <tr key={pod.name} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}>
                    <td className="px-5 py-3 font-mono text-xs text-white/80">{pod.name}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{pod.namespace}</span>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={pod.status} /></td>
                    <td className="px-5 py-3 font-mono text-xs text-white/50">{pod.ready}</td>
                    <td className="px-5 py-3">
                      <span className={`font-mono text-xs ${pod.restarts > 0 ? "text-amber-400" : "text-white/40"}`}>{pod.restarts}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-white/50 font-mono">{pod.node}</td>
                    <td className="px-5 py-3 text-xs text-white/40">{pod.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}

        {/* ── Logs Tab ── */}
        {activeTab === "logs" && (
          <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Log Stream
              </h2>
              <span className="text-xs text-white/30 font-mono">{logs.length} entries</span>
            </div>
            <div ref={logRef} className="h-[480px] overflow-y-auto font-mono text-xs p-4 space-y-1 bg-[#080b14]">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-3 hover:bg-white/[0.02] px-2 py-0.5 rounded transition-colors">
                  <span className="text-white/25 flex-shrink-0 w-16">{log.time}</span>
                  <LogLevel level={log.level} />
                  <span className="text-violet-400/70 flex-shrink-0 w-40 truncate">{log.pod}</span>
                  <span className={`flex-1 ${log.level === "ERROR" ? "text-red-300" : log.level === "WARN" ? "text-amber-300" : "text-white/60"}`}>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Monitoring Tab (Grafana Integration) ── */}
        {activeTab === "monitoring" && (
          <div className="space-y-6">
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden p-1">
              <iframe
                src="http://admin.tutum.my/d-solo/cfe9hn687abk0e/clouddx-overview?orgId=1&refresh=5s&theme=dark&panelId=1"
                width="100%"
                height="800"
                frameBorder="0"
                className="rounded-lg"
                title="Backend API RPS"
              ></iframe>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden p-1">
                <iframe
                  src="http://admin.tutum.my/d-solo/cfe9hn687abk0e/clouddx-overview?orgId=1&refresh=5s&theme=dark&panelId=2"
                  width="100%"
                  height="400"
                  frameBorder="0"
                  className="rounded-lg"
                  title="Error Rate"
                ></iframe>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden p-1">
                <iframe
                  src="http://admin.tutum.my/d-solo/cfe9hn687abk0e/clouddx-overview?orgId=1&refresh=5s&theme=dark&panelId=3"
                  width="100%"
                  height="400"
                  frameBorder="0"
                  className="rounded-lg"
                  title="P95 Latency"
                ></iframe>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
