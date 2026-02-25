"use client";

import { useState, useEffect, useRef } from "react";

// ─── Mock Data ───────────────────────────────────────────────────────────────
const MOCK_NODES = [
  { name: "k8s-master", role: "control-plane", status: "Ready", cpu: 34, mem: 52, ip: "192.168.56.20" },
  { name: "k8s-worker1", role: "worker", status: "Ready", cpu: 61, mem: 73, ip: "192.168.56.21" },
  { name: "k8s-worker2", role: "worker", status: "Ready", cpu: 48, mem: 65, ip: "192.168.56.22" },
];

const MOCK_PODS = [
  { name: "frontend-7d9f8b-xk2p", namespace: "tutum-app", status: "Running", restarts: 0, node: "k8s-worker1", age: "2d" },
  { name: "frontend-7d9f8b-mn4q", namespace: "tutum-app", status: "Running", restarts: 0, node: "k8s-worker2", age: "2d" },
  { name: "backend-6c8d7f-p9rs", namespace: "tutum-app", status: "Running", restarts: 1, node: "k8s-worker1", age: "2d" },
  { name: "backend-6c8d7f-t3uv", namespace: "tutum-app", status: "Running", restarts: 0, node: "k8s-worker2", age: "2d" },
  { name: "redis-0", namespace: "tutum-data", status: "Running", restarts: 0, node: "k8s-worker1", age: "3d" },
  { name: "kafka-0", namespace: "tutum-data", status: "Running", restarts: 2, node: "k8s-worker2", age: "3d" },
  { name: "alloy-ds-xk2p", namespace: "monitoring", status: "Running", restarts: 0, node: "k8s-worker1", age: "1d" },
  { name: "alloy-ds-mn4q", namespace: "monitoring", status: "Running", restarts: 0, node: "k8s-worker2", age: "1d" },
  { name: "ingress-nginx-ctrl", namespace: "ingress-nginx", status: "Running", restarts: 0, node: "k8s-worker1", age: "2d" },
];

const MOCK_METRICS = {
  rps: [12, 18, 24, 31, 28, 35, 42, 38, 45, 52, 48, 55],
  latencyP95: [120, 135, 118, 142, 128, 155, 138, 162, 145, 170, 152, 148],
  errorRate: [0.1, 0.0, 0.2, 0.1, 0.0, 0.3, 0.1, 0.0, 0.2, 0.1, 0.0, 0.1],
  kafkaLag: [0, 2, 5, 3, 1, 0, 4, 2, 0, 1, 0, 0],
};

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
  const [tick, setTick] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Simulate live log stream
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      const newLog = {
        time: new Date().toTimeString().slice(0, 8),
        level: ["INFO", "INFO", "INFO", "WARN", "ERROR"][Math.floor(Math.random() * 5)],
        pod: MOCK_PODS[Math.floor(Math.random() * MOCK_PODS.length)].name,
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
  }, []);

  const filteredPods = nsFilter === "all" ? MOCK_PODS : MOCK_PODS.filter((p) => p.namespace === nsFilter);
  const namespaces = ["all", ...Array.from(new Set(MOCK_PODS.map((p) => p.namespace)))];
  const runningPods = MOCK_PODS.filter((p) => p.status === "Running").length;
  const totalRestarts = MOCK_PODS.reduce((s, p) => s + p.restarts, 0);

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
            <span className="text-xs text-white/30 font-mono">192.168.56.20:6443</span>
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Nodes", value: `${MOCK_NODES.length}`, sub: "All Ready", color: "#34d399", icon: "⬡" },
            { label: "Running Pods", value: `${runningPods}/${MOCK_PODS.length}`, sub: "tutum-app + data", color: "#60a5fa", icon: "◉" },
            { label: "Total Restarts", value: `${totalRestarts}`, sub: "Last 24h", color: totalRestarts > 3 ? "#f59e0b" : "#34d399", icon: "↺" },
            { label: "Ingress IP", value: "192.168.56.100", sub: "MetalLB", color: "#a78bfa", icon: "⇄" },
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {MOCK_NODES.map((n) => (
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
                      <GaugeBar value={n.cpu} color="#60a5fa" />
                      <div className="flex justify-between text-xs text-white/40 mb-0.5 mt-2">
                        <span>Memory</span>
                      </div>
                      <GaugeBar value={n.mem} color="#a78bfa" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Metrics Charts (LGTM Integration) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "API Requests/s", panelId: "14", color: "#60a5fa" },
                { label: "P95 Latency (ms)", panelId: "15", color: "#a78bfa" },
                { label: "Error Rate (%)", panelId: "16", color: "#f87171" },
                { label: "Kafka Lag", panelId: "17", color: "#34d399" },
              ].map((m) => (
                <div key={m.label} className="bg-white/[0.03] border border-white/5 rounded-xl p-0 overflow-hidden h-32 relative group">
                  <div className="absolute top-3 left-4 text-[10px] text-white/40 font-bold uppercase tracking-widest z-10 pointer-events-none group-hover:text-white/70 transition-colors">
                    {m.label}
                  </div>
                  <iframe
                    src={`https://admin.tutum.my/d-solo/rYdd6i9Zz/tutum-cluster-overview?orgId=1&refresh=5s&theme=dark&panelId=${m.panelId}`}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    className="opacity-80 hover:opacity-100 transition-opacity"
                  ></iframe>
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
              <h2 className="text-sm font-semibold text-white/70">Pods</h2>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {["Name", "Namespace", "Status", "Restarts", "Node", "Age"].map((h) => (
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
                    <td className="px-5 py-3">
                      <span className={`font-mono text-xs ${pod.restarts > 0 ? "text-amber-400" : "text-white/40"}`}>{pod.restarts}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-white/50 font-mono">{pod.node}</td>
                    <td className="px-5 py-3 text-xs text-white/40">{pod.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                src="https://admin.tutum.my/d-solo/rYdd6i9Zz/tutum-cluster-overview?orgId=1&refresh=5s&theme=dark&panelId=1"
                width="100%"
                height="800"
                frameBorder="0"
                className="rounded-lg"
                title="Grafana Dashboard"
              ></iframe>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden p-1">
                <iframe
                  src="https://admin.tutum.my/d-solo/rYdd6i9Zz/tutum-cluster-overview?orgId=1&refresh=5s&theme=dark&panelId=2"
                  width="100%"
                  height="400"
                  frameBorder="0"
                  className="rounded-lg"
                ></iframe>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden p-1">
                <iframe
                  src="https://admin.tutum.my/d-solo/rYdd6i9Zz/tutum-cluster-overview?orgId=1&refresh=5s&theme=dark&panelId=3"
                  width="100%"
                  height="400"
                  frameBorder="0"
                  className="rounded-lg"
                ></iframe>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
