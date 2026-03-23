"use client";

import { useState, useEffect, useRef, useCallback, type ComponentProps } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GRAFANA  = "http://192.168.0.230:3000";
// Optional feature flag so the Cost tab can stay out of regular demos.
const ADMIN_COST_TAB_ENABLED = process.env.NEXT_PUBLIC_ADMIN_COST_TAB === "true";
const SHOW_LEGACY_TAB_AI = true;

// ??? Palette ??????????????????????????????????????????????????????????????????
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

const STATUS_LABELS: Record<string, string> = {
  Running: "실행 중",
  RUNNING: "실행 중",
  Ready: "준비 완료",
  OK: "정상",
  Bound: "연결됨",
  Pending: "대기 중",
  WARN: "경고",
  Failed: "실패",
  Error: "오류",
  ERROR: "오류",
  Lost: "손실",
  Stopped: "중지",
  Unknown: "알 수 없음",
  UNKNOWN: "알 수 없음",
  NO_RUN: "미실행",
  CrashLoopBackOff: "반복 재시작",
  OOMKilled: "메모리 부족 종료",
  Evicted: "축출됨",
  ImagePullBackOff: "이미지 가져오기 실패",
  ErrImagePull: "이미지 가져오기 오류",
  CreateContainerConfigError: "컨테이너 설정 오류",
};

const LOG_LEVEL_LABELS: Record<string, string> = {
  INFO: "정보",
  WARN: "경고",
  ERROR: "오류",
  DEBUG: "디버그",
};

const LOG_SEVERITY_LABELS: Record<LogSeverity, string> = {
  INFO: "정보",
  WARN: "경고",
  CRITICAL: "심각",
};

const DIAG_SEVERITY_LABELS: Record<"OK" | "WARN" | "CRITICAL", string> = {
  OK: "정상",
  WARN: "경고",
  CRITICAL: "심각",
};

const PRIORITY_LABELS: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "높음",
  MEDIUM: "중간",
  LOW: "낮음",
};

function translateStatus(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function translateClusterHealth(status: string) {
  if (status === "UNKNOWN") return "상태 확인 중";
  return DIAG_SEVERITY_LABELS[status as "OK" | "WARN" | "CRITICAL"];
}

// ??? Types ????????????????????????????????????????????????????????????????????
type NodeInfo  = { name: string; role: string; status: string; cpu_percent: number; memory_percent: number; ip: string };
type PodInfo   = { name: string; namespace: string; status: string; node: string; ready: string; start_time: string; downtime_sec: number };
type LogSeverity = "INFO" | "WARN" | "CRITICAL";
type LogEntry    = {
  time: string;
  timestamp: number;
  level: string;
  namespace: string;
  pod: string;
  msg: string;
  severity?: LogSeverity;
  trace_id?: string | null;
  trace_url?: string | null;
  status_code?: number | null;
  path?: string | null;
  method?: string | null;
  source_kind?: string;
};
type ErrorSummary = {
  pod: string;
  namespace: string;
  count: number;
  last_time: string;
  last_msg: string;
  critical_count?: number;
  warn_count?: number;
  info_count?: number;
  traceable_count?: number;
  top_severity?: LogSeverity;
};
type LogSeverityCounts = { critical: number; warn: number; info: number; trace_linked: number };
type DiagIssue = { level: "WARN" | "ERROR"; title: string; detail: string };
type DiagRec   = { priority: "HIGH" | "MEDIUM" | "LOW"; action: string };
type Diagnosis = { severity: "OK" | "WARN" | "CRITICAL"; summary: string; issues: DiagIssue[]; recommendations: DiagRec[] };
type WorkerStatus = { status: string; start_time: string; downtime_sec: number; running: boolean };
type PipelineData = {
  workers: Record<string, WorkerStatus>;
  mongodb: { news_total: number; news_last_1h: number; available: boolean };
  elasticsearch: { news_docs: number; available: boolean };
  recent_logs: Record<string, string[]>;
};
type PipelineComponent = { name: string; label: string; status: "OK" | "WARN" | "ERROR"; summary: string; issues: { title: string; detail: string }[]; actions: { priority: string; action: string }[] };
type PipelineDiagnosis = { overall: "OK" | "WARN" | "CRITICAL"; components: PipelineComponent[] };
type MetricsData = { rps: number[]; latency_p95: number[]; error_rate: number[]; kafka_lag: number[]; error_5xx: number[]; error_4xx: number[]; top_5xx_endpoints?: { endpoint: string; count: number }[] };
type PvcInfo    = { name: string; namespace: string; status: string; capacity: string; storage_class: string; volume: string };
type DataMetrics = {
  redis:         { memory_used_gb: number|null; memory_max_gb: number|null; memory_pct: number|null; clients: number|null; hit_rate_pct: number|null; available: boolean };
  kafka:         { consumer_lag: number|null; throughput_msg_per_min: number|null; available: boolean };
  elasticsearch: { indexing_rate: number|null; jvm_heap_used_gb: number|null; jvm_heap_max_gb: number|null; jvm_heap_pct: number|null; search_qps: number|null; search_latency_ms: number|null; index_latency_ms: number|null; thread_rejected: number|null; store_gb: number|null; available: boolean };
  disk:          { read_mbps: number|null; write_mbps: number|null; total_gb: number|null; avail_gb: number|null; used_gb: number|null; used_pct: number|null; available: boolean; nodes: {hostname: string; node_name: string; total_gb: number; used_gb: number; used_pct: number}[] };
  mongodb:       { connections: number|null; active_readers: number|null; active_writers: number|null; queued_readers: number|null; queued_writers: number|null; ops_read_per_sec: number|null; ops_write_per_sec: number|null; available: boolean };
};
type BackupItem = { name: string; cronjob: string; namespace: string; schedule: string|null; last_run_at: string|null; last_success_at: string|null; status: string; last_error: string|null };
type AlertItem  = {
  level: "CRITICAL" | "WARN";
  category: string;
  message: string;
  action: string;
  owner?: string;
  source?: string;
  signal?: string;
  runbook?: string;
  service?: string;
};
type TraceEntry = { traceID: string; rootServiceName: string; rootTraceName: string; durationMs: number; startTimeMs: number; isError: boolean; grafana_url: string };
type TracesData = { traces: TraceEntry[]; error_traces: TraceEntry[]; client_error_traces: TraceEntry[]; available: boolean };
type CostForecastBucket = {
  instance_type?: string;
  capacity_type?: string;
  nodepool?: string;
  nodes: number;
  hourly_usd: number | null;
  daily_usd: number | null;
};
type CostForecastNode = {
  name: string;
  role: string;
  status: string;
  instance_type: string | null;
  capacity_type: string;
  nodepool: string;
  zone: string;
  hourly_usd: number | null;
  daily_usd: number | null;
  price_source: string;
};
type CostForecast = {
  available: boolean;
  generated_at: string;
  currency: string;
  cluster_name: string;
  assumptions: {
    pricing_source: string;
    spot_discount_ratio: number;
    control_plane_hourly_usd: number;
    nat_gateway_hourly_usd: number;
    nat_gateway_count: number;
    extra_fixed_hourly_usd: number;
    config_envs: string[];
  };
  summary: {
    nodes_total: number;
    aws_labeled_nodes: number;
    priceable_nodes: number;
    unpriced_nodes: number;
    compute_hourly_usd: number | null;
    fixed_hourly_usd: number | null;
    total_hourly_usd: number | null;
    projected_daily_usd: number | null;
  };
  fixed_costs: {
    eks_control_plane_hourly_usd: number | null;
    nat_gateways_hourly_usd: number | null;
    extra_fixed_hourly_usd: number | null;
  };
  breakdown_by_instance: CostForecastBucket[];
  breakdown_by_nodepool: CostForecastBucket[];
  nodes: CostForecastNode[];
  warnings: string[];
};
type CostHistoryDaily = {
  date: string;
  aws_total_usd: number;
  eks_stack_total_usd: number;
  nat_total_usd: number;
};
type CostHistory = {
  available: boolean;
  source_path: string;
  currency: string;
  estimated_eks_start_date: string | null;
  estimated_eks_end_date: string | null;
  days: number;
  totals: {
    aws_total_usd: number;
    eks_stack_total_usd: number;
    nat_total_usd: number;
    eks_control_plane_total_usd: number;
    ec2_total_usd: number;
    load_balancer_total_usd: number;
    vpc_total_usd: number;
  };
  daily: CostHistoryDaily[];
  matched_categories: string[];
  notes: string[];
};

// ??? Worker meta ??????????????????????????????????????????????????????????????
const WORKER_META: Record<string, { label: string; desc: string; icon: string; color: string; group: string }> = {
  "news-producer":    { label: "뉴스 수집",      desc: "Einfomax에서 Kafka로 적재",      icon: "NW",   color: C.blue,    group: "news"  },
  "news-consumer":    { label: "Mongo 저장",     desc: "Kafka에서 MongoDB로 저장",       icon: "MG",   color: C.emerald, group: "news"  },
  "elastic-consumer": { label: "ES 색인",        desc: "Kafka에서 Elasticsearch로 색인", icon: "ES",   color: C.violet,  group: "news"  },
  "price-producer":   { label: "시세 수집",      desc: "거래소 피드를 Kafka로 적재",      icon: "PX",   color: C.cyan,    group: "price" },
  "price-consumer":   { label: "시세 저장",      desc: "Kafka에서 MariaDB로 저장",       icon: "DB",   color: C.pink,    group: "price" },
  "email-worker":     { label: "이메일 워커",    desc: "알림 메일 발송 처리",             icon: "MAIL", color: C.amber,   group: "other" },
  "ocr-worker":       { label: "OCR 워커",       desc: "이미지 텍스트 추출",              icon: "OCR",  color: C.slate,   group: "other" },
};

// ??? Sub-components ???????????????????????????????????????????????????????????

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
      {translateStatus(status)}
    </span>
  );
}

function LogLevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    INFO: "text-sky-400", WARN: "text-amber-400", ERROR: "text-red-400", DEBUG: "text-slate-500",
  };
  return <span className={`font-mono text-xs font-bold w-10 ${map[level] ?? "text-slate-400"}`}>{LOG_LEVEL_LABELS[level] ?? level}</span>;
}

function LogSeverityBadge({ severity }: { severity: LogSeverity }) {
  const map: Record<LogSeverity, string> = {
    INFO: "bg-slate-500/15 text-slate-300 border-slate-500/20",
    WARN: "bg-amber-500/15 text-amber-300 border-amber-500/20",
    CRITICAL: "bg-red-500/15 text-red-300 border-red-500/20",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map[severity]}`}>
      {LOG_SEVERITY_LABELS[severity]}
    </span>
  );
}

function Skel({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-white/[0.06] rounded-md animate-pulse`} />;
}

function Card({ children, className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">{children}</h3>;
}
function Info({ tip }: { tip: string }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = pinned || hovered;

  return (
    <span
      className="relative ml-1.5 inline-flex align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        setPinned((prev) => !prev);
      }}
    >
      <span
        className={`text-xs font-normal normal-case tracking-normal cursor-pointer transition-colors select-none ${
          visible ? "text-blue-400" : "text-white/30 hover:text-white/60"
        }`}
      >
        i
      </span>

      {visible && (
        <div
          className="absolute left-0 top-full z-[9999] mt-2 w-72 max-w-[calc(100vw-1rem)] bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-2.5 shadow-2xl whitespace-pre-line leading-relaxed"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-white/70">{tip}</p>
          {pinned && (
            <button
              className="mt-2 text-[10px] text-white/30 hover:text-white/60"
              onClick={() => setPinned(false)}
            >
              닫기
            </button>
          )}
          <div className="absolute -top-[5px] left-3 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent border-b-[#1a1f2e]" />
        </div>
      )}
    </span>
  );
}

function Val({ v, unit = "", decimals = 1 }: { v: number | null | undefined; unit?: string; decimals?: number }) {
  if (v == null) return <span className="text-white/20">없음</span>;
  return <>{v.toFixed(decimals)}{unit && <span className="text-white/40 text-sm ml-0.5">{unit}</span>}</>;
}

function formatUsd(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "없음";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

// Mini time-series chart for KPI cards
function Sparkline({ data, color, height = 74, unit = "", decimals = 1 }: { data: number[]; color: string; height?: number; unit?: string; decimals?: number }) {
  if (!data || data.length === 0) return <div style={{ height }} className="bg-white/5 rounded" />;
  const len = data.length;
  const now = Date.now();
  const pts = data.map((v, i) => {
      const minsAgo = (len - i - 1) * 5;
      const ts = new Date(now - minsAgo * 60_000);
      return {
        t: ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }),
        v,
      };
    });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={pts} margin={{ top: 4, right: 4, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 2" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="t"
          interval="preserveStartEnd"
          minTickGap={28}
          tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const pt = payload[0];
            return (
              <div className="bg-[#0d1224] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs shadow-xl pointer-events-none">
                <p className="text-white/40 mb-0.5">{pt.payload.t}</p>
                <p className="font-mono font-bold" style={{ color }}>{Number(pt.value).toFixed(decimals)}{unit}</p>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8}
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

function DiagPanel({ diag, loading }: { diag: Diagnosis | null; loading: boolean }) {
  if (loading) return <Card><Skel h="h-32" /></Card>;
  if (!diag) return <Card className="text-center py-8 text-white/20 text-sm">AI 분석을 실행하면 결과가 표시됩니다.</Card>;
  const c = SevColors(diag.severity);
  return (
    <Card className={`${c.bg} ${c.border}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
        <span className={`text-sm font-semibold ${c.text}`}>{DIAG_SEVERITY_LABELS[diag.severity]}</span>
      </div>
      <p className="text-white/80 text-sm mb-4">{diag.summary}</p>
      {diag.issues.length > 0 && (
        <div className="space-y-2 mb-4">
          {diag.issues.map((iss, i) => (
            <div key={i} className="bg-black/20 rounded-lg p-2">
              <p className={`text-xs font-semibold ${iss.level === "ERROR" ? "text-red-400" : "text-amber-400"}`}>{iss.title}</p>
              <p className="text-xs text-white/50 mt-0.5">{iss.detail}</p>
            </div>
          ))}
        </div>
      )}
      {diag.recommendations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-white/30 mb-1">권장 조치</p>
          {diag.recommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                r.priority === "HIGH" ? "bg-red-500/20 text-red-400" : r.priority === "MEDIUM" ? "bg-amber-500/20 text-amber-400" : "bg-slate-500/20 text-slate-400"
              }`}>{PRIORITY_LABELS[r.priority]}</span>
              <span className="text-white/60">{r.action}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ??? Clock (isolated to avoid full dashboard re-render every second) ??????????

function Clock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("ko-KR", { hour12: false }));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("ko-KR", { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{time}</span>;
}

// ??? Main Component ???????????????????????????????????????????????????????????

export default function AdminDashboard() {
  type Tab = "overview" | "cost" | "infra" | "pipeline" | "data" | "backup" | "logs" | "traces";
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Cluster state
  const [nodes,        setNodes]        = useState<NodeInfo[]>([]);
  const [pods,         setPods]         = useState<PodInfo[]>([]);
  const [metrics,      setMetrics]      = useState<MetricsData | null>(null);
  const [pvcs,         setPvcs]         = useState<PvcInfo[]>([]);
  const [dataMetrics,  setDataMetrics]  = useState<DataMetrics | null>(null);
  const [nodeHistory,  setNodeHistory]  = useState<{ cpu: Record<string, {t:string;v:number|null}[]>; memory: Record<string, {t:string;v:number|null}[]>; available: boolean } | null>(null);
  const [loadingNodeH, setLoadingNodeH] = useState(true);
  const [tracesData,   setTracesData]   = useState<TracesData | null>(null);
  const [pipeline,     setPipeline]     = useState<PipelineData | null>(null);
  const [logs,         setLogs]         = useState<LogEntry[]>([]);
  const [errorSummary, setErrorSummary] = useState<ErrorSummary[]>([]);
  const [logSeverityCounts, setLogSeverityCounts] = useState<LogSeverityCounts>({ critical: 0, warn: 0, info: 0, trace_linked: 0 });
  const [diagnosis,    setDiagnosis]    = useState<Diagnosis | null>(null);
  const [pipelineDiag, setPipelineDiag] = useState<PipelineDiagnosis | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupItem[] | null>(null);
  const [alerts,       setAlerts]       = useState<AlertItem[]>([]);
  const [costForecast, setCostForecast] = useState<CostForecast | null>(null);
  const [costHistory,  setCostHistory]  = useState<CostHistory | null>(null);
  const [loadingBackup,setLoadingBackup]= useState(true);

  // Loading states
  const [loadingNodes,   setLoadingNodes]   = useState(true);
  const [loadingPods,    setLoadingPods]    = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [loadingDataM,   setLoadingDataM]   = useState(true);
  const [loadingTraces,  setLoadingTraces]  = useState(true);
  const [loadingPipeline,setLoadingPipeline]= useState(true);
  const [loadingLogs,    setLoadingLogs]    = useState(true);
  const [loadingCost,    setLoadingCost]    = useState(true);
  const [loadingDiag,    setLoadingDiag]    = useState(false);
  const [loadingPDiag,   setLoadingPDiag]   = useState(false);
  const [tabDiag,        setTabDiag]        = useState<Record<string, { result: Diagnosis | null; loading: boolean }>>({});

  // Pods tab filter
  const [nsFilter,  setNsFilter]  = useState("all");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [logNs,     setLogNs]     = useState("tutum-app");
  const [logLevel,  setLogLevel]  = useState("ALL");
  const [logSeverity, setLogSeverity] = useState<"ALL" | LogSeverity>("ALL");
  const [logPod,    setLogPod]    = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState("");

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

  // Fetch helpers
  const showError = (msg: string) => {
    setFetchError(msg);
    setTimeout(() => setFetchError(""), 4000);
  };

  const getApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const payload = await response.json();
      const detail = payload?.detail;

      if (typeof detail === "string" && detail.trim()) return detail;
      if (detail && typeof detail === "object") {
        if (typeof detail.detail === "string" && detail.detail.trim()) return detail.detail;
        if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    } catch (error) {
      console.error("getApiErrorMessage", error);
    }

    return `${fallback} (${response.status})`;
  };

  const runOverviewDiag = async () => {
    setLoadingDiag(true);
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/diagnose`);
      if (r.ok) {
        const d = await r.json();
        setDiagnosis(d.diagnosis);
      } else {
        showError(await getApiErrorMessage(r, "개요 AI 분석에 실패했습니다"));
      }
    } catch (error) {
      console.error("runOverviewDiag", error);
      showError("개요 AI 분석에 실패했습니다");
    } finally {
      setLoadingDiag(false);
    }
  };

  const runPipelineDiag = async () => {
    setLoadingPDiag(true);
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pipeline-diagnose`);
      if (r.ok) {
        const d = await r.json();
        setPipelineDiag(d.diagnosis);
      } else {
        showError(await getApiErrorMessage(r, "파이프라인 AI 분석에 실패했습니다"));
      }
    } catch (error) {
      console.error("runPipelineDiag", error);
      showError("파이프라인 AI 분석에 실패했습니다");
    } finally {
      setLoadingPDiag(false);
    }
  };

  const runTabDiag = async (tabId: string, endpoint: string) => {
    setTabDiag(p => ({ ...p, [tabId]: { result: p[tabId]?.result ?? null, loading: true } }));
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/${endpoint}`);
      if (r.ok) {
        const d = await r.json();
        setTabDiag(p => ({ ...p, [tabId]: { result: d.diagnosis, loading: false } }));
      } else {
        setTabDiag(p => ({ ...p, [tabId]: { result: p[tabId]?.result ?? null, loading: false } }));
        showError(await getApiErrorMessage(r, `${tabId} 탭 AI 분석에 실패했습니다`));
      }
    } catch (error) {
      console.error(`runTabDiag:${tabId}`, error);
      setTabDiag(p => ({ ...p, [tabId]: { result: p[tabId]?.result ?? null, loading: false } }));
      showError(`${tabId} 탭 AI 분석에 실패했습니다`);
    }
  };

  const fetchNodes = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/nodes`);
      if (r.ok) { const d = await r.json(); setNodes(d.nodes || []); }
      else showError("노드 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchNodes", e); showError("노드 정보를 불러오지 못했습니다"); }
    finally { setLoadingNodes(false); setLastUpdated(new Date().toLocaleTimeString("ko-KR")); }
  }, []);

  const fetchPods = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pods`);
      if (r.ok) { const d = await r.json(); setPods(d.pods || []); }
      else showError("파드 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchPods", e); showError("파드 정보를 불러오지 못했습니다"); }
    finally { setLoadingPods(false); }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/metrics`);
      if (r.ok) setMetrics(await r.json());
      else showError("메트릭을 불러오지 못했습니다");
    } catch (e) { console.error("fetchMetrics", e); }
    finally { setLoadingMetrics(false); setMetricsUpdatedAt(new Date().toLocaleTimeString("ko-KR")); }
  }, []);

  const fetchStorage = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/storage`);
      if (r.ok) { const d = await r.json(); setPvcs(d.pvcs || []); }
      else showError("스토리지 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchStorage", e); }
    finally { setLoadingStorage(false); }
  }, []);

  const fetchDataMetrics = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/data-metrics`);
      if (r.ok) setDataMetrics(await r.json());
      else showError("데이터 메트릭을 불러오지 못했습니다");
    } catch (e) { console.error("fetchDataMetrics", e); }
    finally { setLoadingDataM(false); }
  }, []);

  const fetchCostForecast = useCallback(async () => {
    if (!ADMIN_COST_TAB_ENABLED) {
      setLoadingCost(false);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/cost-forecast`);
      if (r.ok) setCostForecast(await r.json());
      else showError("비용 예측 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchCostForecast", e); }
    finally { setLoadingCost(false); }
  }, []);
  const fetchCostHistory = useCallback(async () => {
    if (!ADMIN_COST_TAB_ENABLED) return;
    try {
      const r = await fetch("/api/public/cost-history", { cache: "no-store" });
      if (r.ok) setCostHistory(await r.json());
      else console.error("cost-history fetch failed", await r.text());
    } catch (e) {
      console.error("fetchCostHistory", e);
    }
  }, []);

  const fetchBackupAndAlerts = useCallback(async () => {
    try {
      const [br, ar] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/backup-status`),
        fetch(`${API_BASE}/api/v1/admin/action-needed`),
      ]);
      if (br.ok) { const d = await br.json(); setBackupStatus(d.backups); }
      if (ar.ok) { const d = await ar.json(); setAlerts(d.alerts ?? []); }
    } catch (e) { console.error("fetchBackupAndAlerts", e); }
    finally { setLoadingBackup(false); }
  }, []);

  const fetchNodeHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/node-history`);
      if (r.ok) setNodeHistory(await r.json());
    } catch (e) { console.error("fetchNodeHistory", e); }
    finally { setLoadingNodeH(false); }
  }, []);

  const fetchTraces = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/traces?limit=20&min_duration_ms=50`);
      if (r.ok) { setTracesData(await r.json()); }
      else showError("추적 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchTraces", e); }
    finally { setLoadingTraces(false); }
  }, []);

  const fetchPipeline = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/pipeline`);
      if (r.ok) setPipeline(await r.json());
      else showError("파이프라인 정보를 불러오지 못했습니다");
    } catch (e) { console.error("fetchPipeline", e); }
    finally { setLoadingPipeline(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/admin/logs?namespace=${logNs}&limit=100`);
      if (r.ok) {
        const d = await r.json();
        setLogs(d.logs || []);
        setErrorSummary(d.error_summary || []);
        setLogSeverityCounts(d.severity_counts || { critical: 0, warn: 0, info: 0, trace_linked: 0 });
      } else showError("로그를 불러오지 못했습니다");
    } catch (e) { console.error("fetchLogs", e); }
    finally { setLoadingLogs(false); }
  }, [logNs]);

  // Initial + polling
  useEffect(() => {
    fetchNodes(); fetchPods(); fetchMetrics(); fetchStorage(); fetchDataMetrics(); fetchCostForecast(); fetchCostHistory(); fetchTraces(); fetchPipeline(); fetchLogs(); fetchNodeHistory(); fetchBackupAndAlerts();
    const id30 = setInterval(() => { fetchNodes(); fetchPods(); fetchMetrics(); fetchStorage(); fetchDataMetrics(); fetchCostForecast(); fetchCostHistory(); fetchPipeline(); fetchBackupAndAlerts(); }, 30_000);
    const id10 = setInterval(() => fetchLogs(), 10_000);
    const id60 = setInterval(() => fetchTraces(), 60_000);
    const id5m = setInterval(() => fetchNodeHistory(), 300_000); // refresh every 5 minutes
    return () => { clearInterval(id30); clearInterval(id10); clearInterval(id60); clearInterval(id5m); };
  }, [fetchNodes, fetchPods, fetchMetrics, fetchStorage, fetchDataMetrics, fetchCostForecast, fetchCostHistory, fetchTraces, fetchPipeline, fetchLogs, fetchNodeHistory, fetchBackupAndAlerts]);

  // Scroll logs to top when new entries arrive (newest-first order)
  useEffect(() => {
    logRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [logs]);

  // Reset filters when logNs changes
  useEffect(() => {
    setLogPod("");
    setLogLevel("ALL");
    setLogSeverity("ALL");
  }, [logNs]);

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
      e5xx: Math.round(metrics.error_5xx?.[i] ?? 0),
      e4xx: Math.round(metrics.error_4xx?.[i] ?? 0),
    }));
  })();

  // Pod status breakdown (pie chart)
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
    (logSeverity === "ALL" || (l.severity ?? "INFO") === logSeverity) &&
    (logLevel === "ALL" || l.level === logLevel) &&
    (!logPod || l.pod.includes(logPod))
  );
  const diskNodeRows = (() => {
    const metricNodes = dataMetrics?.disk?.nodes ?? [];
    if (!nodes.length) return metricNodes.map(n => ({ ...n, missing: false }));

    const byNodeName = new Map(metricNodes.map(n => [n.node_name, n] as const));
    const byHost = new Map(metricNodes.map(n => [n.hostname, n] as const));

    const rows = nodes.map(node => {
      const matched = byNodeName.get(node.name) ?? (node.ip ? byHost.get(node.ip) : undefined);
      if (matched) return { ...matched, missing: false };
      return {
        hostname: node.ip || node.name,
        node_name: node.name,
        total_gb: 0,
        used_gb: 0,
        used_pct: 0,
        missing: true,
      };
    });

    const known = new Set(rows.map(r => r.node_name));
    metricNodes.forEach(n => {
      if (!known.has(n.node_name)) rows.push({ ...n, missing: false });
    });

    return rows.sort((a, b) => a.node_name.localeCompare(b.node_name));
  })();
  const missingDiskNodeNames = diskNodeRows.filter(n => n.missing).map(n => n.node_name);
  const expensiveCostNodes = (costForecast?.nodes ?? [])
    .filter(node => node.hourly_usd != null)
    .slice(0, 5);
  const costNodepoolRows = (costForecast?.breakdown_by_nodepool ?? [])
    .filter(bucket => bucket.hourly_usd != null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview",  label: "개요" },
    { id: "infra",     label: "인프라" },
    { id: "pipeline",  label: "파이프라인" },
    { id: "data",      label: "데이터" },
    { id: "backup",    label: "백업" },
    { id: "logs",      label: "로그" },
    { id: "traces",    label: "추적" },
    ...(ADMIN_COST_TAB_ENABLED ? [{ id: "cost" as Tab, label: "비용" }] : []),
  ];

  // ??? Render ????????????????????????????????????????????????????????????????

  return (
    <div className="min-h-screen text-white" style={{ background: "#080d1a", fontFamily: "'Inter', sans-serif" }}>

      {/* ?? Header ?????????????????????????????????????????????????????????? */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080d1a]/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight" style={{ color: C.blue }}>Tutum</span>
            <span className="text-white/30 text-sm font-medium">모니터링</span>
          </div>

          {/* Cluster health */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium"
               style={{
                 borderColor: clusterHealth === "OK" ? "rgba(16,185,129,0.3)" : clusterHealth === "WARN" ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)",
                 color: clusterHealth === "OK" ? C.emerald : clusterHealth === "WARN" ? C.amber : C.red,
                 background: clusterHealth === "OK" ? "rgba(16,185,129,0.08)" : clusterHealth === "WARN" ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)",
               }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: clusterHealth === "OK" ? C.emerald : clusterHealth === "WARN" ? C.amber : C.red }} />
            클러스터 {translateClusterHealth(clusterHealth)}
          </div>

          {/* Right: time + refresh */}
          <div className="flex items-center gap-4 text-xs text-white/40">
            <Clock />
            {lastUpdated && <span>갱신 {lastUpdated}</span>}
            <button
              onClick={async () => {
                setIsRefreshing(true);
                await Promise.all([fetchNodes(), fetchPods(), fetchMetrics(), fetchStorage(), fetchDataMetrics(), fetchCostForecast(), fetchCostHistory(), fetchPipeline(), fetchLogs(), fetchTraces()]);
                setIsRefreshing(false);
              }}
              disabled={isRefreshing}
              className="px-3 py-1 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition text-white/60 hover:text-white text-xs disabled:opacity-50">
              {isRefreshing ? "새로고침 중..." : "새로고침"}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-6 flex gap-1 pb-0">
          {tabs.map(t => (
            <button key={t.id}
                    onClick={() => { setActiveTab(t.id); setNsFilter("all"); setNodeFilter("all"); setLogPod(""); setLogLevel("ALL"); }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
                      activeTab === t.id
                        ? "border-blue-400 text-blue-400"
                        : "border-transparent text-white/40 hover:text-white/70"
                    }`}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Error toast */}
      {fetchError && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-500/20 border border-red-500/30 text-red-400 text-xs px-4 py-2 rounded-lg shadow-lg">
          오류: {fetchError}
        </div>
      )}

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: OVERVIEW
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "overview" && (
          <div className="space-y-6">

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "RPS",        val: metrics?.rps.at(-1),          unit: "",    data: metrics?.rps,          color: C.blue,    decimals: 1 },
                { label: "P95 응답시간", val: metrics?.latency_p95.at(-1), unit: "ms", data: metrics?.latency_p95,  color: C.violet,  decimals: 0 },
                { label: "오류율",       val: metrics?.error_rate.at(-1),  unit: "%",  data: metrics?.error_rate,   color: C.red,     decimals: 2 },
                { label: "Kafka 적체",   val: metrics?.kafka_lag.at(-1),   unit: "",   data: metrics?.kafka_lag,    color: C.amber,   decimals: 0 },
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
                      <Sparkline data={kpi.data ?? []} color={kpi.color} unit={kpi.unit} decimals={kpi.decimals} />
                    </>
                  )}
                </Card>
              ))}
            </div>

            {/* KPI timestamp */}
            {metricsUpdatedAt && (
              <p className="text-xs text-white/30 text-right -mt-4">갱신 {metricsUpdatedAt} | 30초 자동 새로고침</p>
            )}

            {/* RPS + Latency combined line chart */}
            <Card>
              <SectionTitle>API 처리량 / 응답 시간 (최근 1시간)<Info tip={"RPS는 초당 처리 요청 수입니다.\nP95 응답시간은 상위 95% 요청이 이 값 이하에서 끝난다는 의미입니다.\n빨간 기준선은 100ms 임계치입니다."} /></SectionTitle>
              {loadingMetrics ? (
                <Skel h="h-48" />
              ) : metricsChartData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-white/20 text-sm">Mimir 데이터가 없습니다</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={metricsChartData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill: "rgba(34,211,238,0.9)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: "rgba(244,114,182,0.9)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
                    <Line yAxisId="l" type="monotone" dataKey="rps" name="RPS" stroke={C.cyan} strokeWidth={2.4} dot={false} isAnimationActive={false} />
                    <Line yAxisId="r" type="monotone" dataKey="lat" name="P95 ms" stroke={C.pink} strokeWidth={2.4} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                    {/* 硫섑넗 ?쇰뱶諛? P95 ?덉씠?댁떆 100ms ?댁긽 = ?ш컖 */}
                    <ReferenceLine yAxisId="r" y={100} stroke={C.red} strokeDasharray="4 2"
                      label={{ value: "100ms 임계치", position: "insideTopRight", fill: C.red, fontSize: 10 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Error rate + Kafka lag */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle>오류 건수 (5xx / 4xx)<Info tip={"5xx는 서버 측 오류입니다.\n4xx는 클라이언트 측 요청 오류입니다.\n5xx 급증은 보통 백엔드 점검이 필요하고, 4xx 급증은 인증 또는 호출 방식 문제일 가능성이 큽니다."} /></SectionTitle>
                {loadingMetrics ? <Skel h="h-36" /> : metricsChartData.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-white/20 text-sm">데이터가 없습니다</div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={metricsChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip unit=" count" />} />
                      <Bar dataKey="e5xx" name="5xx" stackId="err" fill={C.red} fillOpacity={0.8} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="e4xx" name="4xx" stackId="err" fill={C.amber} fillOpacity={0.7} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {/* 5xx 諛쒖깮 ?붾뱶?ъ씤??Top 5 */}
                {metrics?.top_5xx_endpoints && metrics.top_5xx_endpoints.length > 0 && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <p className="text-[10px] text-white/30 mb-1.5">최근 1시간 5xx 상위 엔드포인트</p>
                    <table className="w-full text-xs">
                      <tbody>
                        {metrics.top_5xx_endpoints.map((ep, i) => (
                          <tr key={i} className="border-b border-white/5 last:border-0">
                            <td className="py-1 text-white/40 pr-2 font-mono truncate max-w-[180px]" title={ep.endpoint}>{ep.endpoint}</td>
                            <td className="py-1 text-right text-red-400 font-semibold">{ep.count.toFixed(0)}건</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card>
                <SectionTitle>Kafka 컨슈머 적체<Info tip={"컨슈머 적체는 아직 처리되지 않은 메시지 수를 의미합니다.\n적체가 계속 증가하면 컨슈머가 느리거나 워커가 멈췄을 가능성이 큽니다.\n운영 임계치를 넘기면 즉시 확인이 필요합니다."} /></SectionTitle>
                {loadingMetrics ? <Skel h="h-36" /> : metricsChartData.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-white/20 text-sm">데이터가 없습니다</div>
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
                { label: "노드", val: nodes.length, sub: `준비 완료 ${nodes.filter(n => n.status === "Ready").length}`, color: C.blue, icon: "ND" },
                { label: "파드", val: pods.length, sub: `실행 중 ${pods.filter(p => p.status === "Running").length}`, color: C.emerald, icon: "PD" },
                { label: "PVC",  val: pvcs.length, sub: `연결됨 ${pvcs.filter(p => p.status === "Bound").length}`, color: C.violet, icon: "PV" },
              ].map(s => (
                <Card key={s.label} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                       style={{ background: `${s.color}18` }}>{s.icon}</div>
                  <div>
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.val}</p>
                    <p className="text-xs text-white/40">{s.label} | {s.sub}</p>
                  </div>
                </Card>
              ))}
            </div>

            {/* AI 遺꾩꽍 */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>AI 분석<Info tip={"Claude가 노드, 파드, 핵심 메트릭을 함께 분석합니다.\n결과 심각도는 정상, 경고, 심각으로 요약됩니다.\n전체 운영 상태를 빠르게 파악할 때 사용합니다."} /></SectionTitle>
                <button onClick={runOverviewDiag} disabled={loadingDiag}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                  {loadingDiag ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              <DiagPanel diag={diagnosis} loading={loadingDiag} />
            </div>
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: INFRA
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {/* Cost tab (optional) */}
        {ADMIN_COST_TAB_ENABLED && activeTab === "cost" && (
          <div className="space-y-4">
            <SectionTitle>
              예상 비용
              <Info tip={"현재 활성화된 EKS 노드와 고정 인프라 가정을 바탕으로 계산한 운영용 추정치입니다.\n실제 AWS 청구 데이터를 볼 수 없을 때 참고용으로 사용합니다.\n최종 청구 금액과는 차이가 있을 수 있습니다."} />
            </SectionTitle>

            {loadingCost ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card><Skel h="h-24" /></Card>
                <Card><Skel h="h-24" /></Card>
                <Card><Skel h="h-24" /></Card>
              </div>
            ) : !costForecast && !costHistory ? (
              <Card>
                <p className="text-sm text-white/30">비용 예측 정보가 아직 없습니다.</p>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="border border-cyan-500/20 bg-cyan-500/[0.04]">
                    <p className="text-xs text-white/40 mb-2">누적 EKS 스택 비용</p>
                    <p className="text-3xl font-bold font-mono" style={{ color: C.cyan }}>
                      {formatUsd(costHistory?.totals.eks_stack_total_usd ?? null)}
                    </p>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/40">CSV 출처</span>
                        <span className="font-mono text-white/50">{costHistory ? "로컬 가져오기" : "-"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">시작</span>
                        <span className="font-mono text-white/50">{costHistory?.estimated_eks_start_date ?? "-"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">종료</span>
                        <span className="font-mono text-white/50">{costHistory?.estimated_eks_end_date ?? "-"}</span>
                      </div>
                    </div>
                  </Card>

                  <Card className="border border-violet-500/20 bg-violet-500/[0.04]">
                    <p className="text-xs text-white/40 mb-2">누적 NAT 비용</p>
                    <p className="text-3xl font-bold font-mono" style={{ color: C.violet }}>
                      {formatUsd(costHistory?.totals.nat_total_usd ?? costForecast?.fixed_costs.nat_gateways_hourly_usd ?? null)}
                    </p>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/40">현재 NAT 시간당</span>
                        <span className="font-mono text-white/70">{formatUsd(costForecast?.fixed_costs.nat_gateways_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">VPC 누적</span>
                        <span className="font-mono text-white/50">{formatUsd(costHistory?.totals.vpc_total_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">LB 누적</span>
                        <span className="font-mono text-white/50">{formatUsd(costHistory?.totals.load_balancer_total_usd ?? null)}</span>
                      </div>
                    </div>
                  </Card>

                  <Card className="border border-amber-500/20 bg-amber-500/[0.04]">
                    <p className="text-xs text-white/40 mb-2">예상 일일 비용</p>
                    <p className="text-3xl font-bold font-mono" style={{ color: C.amber }}>
                      {formatUsd(costForecast?.summary.projected_daily_usd ?? null)}
                    </p>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-white/40">시간당 합계</span>
                        <span className="font-mono text-white/70">{formatUsd(costForecast?.summary.total_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">클러스터</span>
                        <span className="font-mono text-white/50">{costForecast?.cluster_name ?? "-"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">갱신</span>
                        <span className="font-mono text-white/50">
                          {costForecast?.generated_at ? new Date(costForecast.generated_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "-"}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Card className="lg:col-span-3">
                    <p className="text-xs text-white/40 mb-2">가져온 CSV 요약</p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <p className="text-white/40 text-xs mb-1">AWS 월 누적</p>
                        <p className="font-mono font-semibold text-white/80">{formatUsd(costHistory?.totals.aws_total_usd ?? null)}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <p className="text-white/40 text-xs mb-1">EC2 누적</p>
                        <p className="font-mono font-semibold text-white/80">{formatUsd(costHistory?.totals.ec2_total_usd ?? null)}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <p className="text-white/40 text-xs mb-1">EKS 컨트롤 플레인</p>
                        <p className="font-mono font-semibold text-white/80">{formatUsd(costHistory?.totals.eks_control_plane_total_usd ?? null)}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <p className="text-white/40 text-xs mb-1">가져온 일수</p>
                        <p className="font-mono font-semibold text-white/80">{costHistory?.days ?? "-"}</p>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <p className="text-xs text-white/40 mb-2">비용 구성</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/50">컴퓨트 / 시간</span>
                        <span className="font-mono font-semibold" style={{ color: C.blue }}>{formatUsd(costForecast?.summary.compute_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">고정 / 시간</span>
                        <span className="font-mono font-semibold" style={{ color: C.violet }}>{formatUsd(costForecast?.summary.fixed_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">가격 산정 노드</span>
                        <span className="font-mono text-white/70">{costForecast ? `${costForecast.summary.priceable_nodes}/${costForecast.summary.aws_labeled_nodes}` : "-"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">미산정 노드</span>
                        <span className="font-mono" style={{ color: (costForecast?.summary.unpriced_nodes ?? 0) > 0 ? C.red : C.emerald }}>
                          {costForecast?.summary.unpriced_nodes ?? "-"}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <p className="text-xs text-white/40 mb-2">고정 가정값</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/50">EKS 컨트롤 플레인</span>
                        <span className="font-mono text-white/70">{formatUsd(costForecast?.fixed_costs.eks_control_plane_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">NAT 게이트웨이 / 시간</span>
                        <span className="font-mono text-white/70">{formatUsd(costForecast?.fixed_costs.nat_gateways_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">기타 고정 / 시간</span>
                        <span className="font-mono text-white/70">{formatUsd(costForecast?.fixed_costs.extra_fixed_hourly_usd ?? null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">스팟 비율</span>
                        <span className="font-mono text-white/50">{costForecast ? `${Math.round(costForecast.assumptions.spot_discount_ratio * 100)}%` : "-"}</span>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <SectionTitle>노드풀별</SectionTitle>
                    {costNodepoolRows.length === 0 ? (
                      <p className="text-sm text-white/25">노드풀 비용 데이터가 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {costNodepoolRows.map((bucket) => (
                          <div key={bucket.nodepool} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                            <div>
                              <p className="text-sm font-medium text-white/80">{bucket.nodepool}</p>
                              <p className="text-[11px] text-white/35">{bucket.nodes}개 노드</p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono font-semibold" style={{ color: C.amber }}>{formatUsd(bucket.daily_usd)}</p>
                              <p className="text-[11px] text-white/35">{formatUsd(bucket.hourly_usd)}/시간</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card>
                    <SectionTitle>비용 상위 노드</SectionTitle>
                    {expensiveCostNodes.length === 0 ? (
                      <p className="text-sm text-white/25">가격 산정 가능한 노드 정보가 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {expensiveCostNodes.map((node) => (
                          <div key={node.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white/80 truncate">{node.name}</p>
                              <p className="text-[11px] text-white/35 truncate">
                                {node.instance_type ?? "알 수 없음"} | {node.capacity_type} | {node.nodepool}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono font-semibold" style={{ color: C.blue }}>{formatUsd(node.daily_usd)}</p>
                              <p className="text-[11px] text-white/35">{formatUsd(node.hourly_usd)}/시간</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                {costForecast && costForecast.warnings.length > 0 && (
                  <Card className="border border-red-500/20 bg-red-500/[0.04]">
                    <p className="text-xs text-red-400 mb-2">추정기 경고</p>
                    <div className="space-y-1">
                      {costForecast.warnings.map((warning) => (
                        <p key={warning} className="text-xs text-white/65">{warning}</p>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>

        )}

        {activeTab === "infra" && (
          <div className="space-y-6">

            {/* Node grid */}
            <div>
              <SectionTitle>노드 ({nodes.length})<Info tip={"클러스터 노드 목록과 현재 CPU, 메모리 사용률을 보여줍니다."} /></SectionTitle>
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
                          <p className="text-[10px] text-white/30 mb-0.5">메모리</p>
                          <GaugeBar value={n.memory_percent} color={C.violet} />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Node 24h time series */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(["cpu", "memory"] as const).map(metric => (
                <Card key={metric}>
                  <SectionTitle>{metric === "cpu" ? "노드 CPU 사용률 (24시간)" : "노드 메모리 사용률 (24시간)"}<Info tip={"node-exporter 기준 최근 24시간 추이입니다."} /></SectionTitle>
                  {loadingNodeH ? <Skel h="h-40" /> : !nodeHistory?.available ? (
                    <div className="h-40 flex items-center justify-center text-white/20 text-xs">
                      node-exporter 메트릭이 아직 충분히 수집되지 않았습니다.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                        data={(() => {
                          const series = nodeHistory[metric];
                          const workerKeys = Object.keys(series).filter(k => k.startsWith("worker"));
                          const len = Math.max(...workerKeys.map(k => series[k]?.length ?? 0));
                          return Array.from({ length: len }, (_, i) => {
                            const pt: Record<string, string | number | null> = { t: series[workerKeys[0]]?.[i]?.t ?? "" };
                            workerKeys.forEach(k => { pt[k] = series[k]?.[i]?.v ?? null; });
                            return pt;
                          });
                        })()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 8 }} axisLine={false} tickLine={false} interval={23} />
                        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} unit="%" />
                        <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%`]} labelStyle={{ color: "rgba(255,255,255,0.5)" }} contentStyle={{ background: "#1e2330", border: "1px solid rgba(255,255,255,0.08)" }} />
                        {Object.keys(nodeHistory[metric]).filter(k => k.startsWith("worker")).map((k, i) => (
                          <Line key={k} type="monotone" dataKey={k} name={k}
                            stroke={[C.blue, C.violet, C.emerald][i % 3]} strokeWidth={1.5}
                            dot={false} isAnimationActive={false} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              ))}
            </div>

            {/* Pod status pie + PVC table */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle>파드 상태 ({pods.length})<Info tip={"실행 중, 대기, 실패, 축출 파드 분포를 보여줍니다."} /></SectionTitle>
                {loadingPods ? <Skel h="h-48" /> : (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={podStats} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                             dataKey="value" isAnimationActive={false}>
                          {podStats.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
                        </Pie>
                        <Tooltip formatter={(v: number, n: string) => [`${v}`, n]} />
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
                <SectionTitle>PVC 스토리지<Info tip={"퍼시스턴트 볼륨 클레임과 현재 바인딩 상태입니다."} /></SectionTitle>
                {loadingStorage ? <Skel h="h-48" /> : pvcs.length === 0 ? (
                  <p className="text-white/20 text-sm">PVC가 없습니다.</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {pvcs.map(p => (
                      <div key={`${p.namespace}/${p.name}`}
                           className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                        <div>
                          <p className="text-xs font-medium">{p.name}</p>
                          <p className="text-[10px] text-white/30">{p.namespace} / {p.storage_class}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-white/60">{p.capacity || "-"}</span>
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
                  파드 목록<Info tip={"현재 파드 상태, 재시작 수, 배치된 노드를 보여줍니다."} />
                  {nodeFilter !== "all" && <span className="text-xs text-blue-400/80 ml-2">노드: {nodeFilter}</span>}
                </SectionTitle>
                <div className="flex items-center gap-2">
                  <select value={nsFilter} onChange={e => setNsFilter(e.target.value)}
                          className="text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-white/60 outline-none">
                    {["all", "tutum-app", "tutum-data", "monitoring", "keda"].map(ns => (
                      <option key={ns} value={ns}>{ns === "all" ? "전체" : ns}</option>
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
                        {["이름", "네임스페이스", "상태", "준비", "다운타임", "노드", "시작 시각"].map(h => (
                          <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPods.map(p => (
                        <tr key={`${p.namespace}/${p.name}`}
                            className="border-b border-white/[0.03] hover:bg-white/[0.02] transition">
                          <td className="py-1.5 pr-4 font-mono max-w-[180px] truncate" title={p.name}>{p.name}</td>
                          <td className="py-1.5 pr-4 text-white/50">{p.namespace}</td>
                          <td className="py-1.5 pr-4"><StatusBadge status={p.status} /></td>
                          <td className="py-1.5 pr-4 font-mono text-white/50">{p.ready}</td>
                          <td className="py-1.5 pr-4">
                            {p.downtime_sec > 0
                              ? <span className="text-amber-400 font-bold">{p.downtime_sec < 60 ? `${p.downtime_sec}s` : `${Math.round(p.downtime_sec / 60)}m`}</span>
                              : <span className="text-white/20">-</span>}
                          </td>
                          <td className="py-1.5 pr-4 text-white/50">{p.node}</td>
                          <td className="py-1.5 text-white/30 font-mono text-xs">
                            {p.start_time !== "-" ? new Date(p.start_time).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* AI 遺꾩꽍 */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>AI 분석<Info tip={"Claude가 노드와 파드 상태를 함께 분석합니다.\nCPU, 메모리, 재시작, CrashLoop 위험 신호를 요약해 빠르게 인프라 상태를 파악할 수 있습니다."} /></SectionTitle>
                <button onClick={() => runTabDiag("infra", "infra-diagnose")} disabled={tabDiag["infra"]?.loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                  {tabDiag["infra"]?.loading ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              <DiagPanel diag={tabDiag["infra"]?.result ?? null} loading={tabDiag["infra"]?.loading ?? false} />
            </div>
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: PIPELINE
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "pipeline" && (
          <div className="space-y-6">

            {/* Action Needed 諛곕꼫 */}
            {alerts.length > 0 && (
              <div className="space-y-2">
                <SectionTitle>즉시 확인 필요<Info tip={"현재 임계치를 기준으로 운영 경고를 표시합니다.\nCRITICAL은 즉시 대응이 필요합니다.\nWARN은 가까이서 모니터링해야 합니다.\n30초마다 자동 갱신됩니다."} /></SectionTitle>
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl border text-sm"
                    style={{
                      borderColor: a.level === "CRITICAL" ? "rgba(239,68,68,0.4)" : "rgba(251,191,36,0.4)",
                      background:  a.level === "CRITICAL" ? "rgba(239,68,68,0.08)" : "rgba(251,191,36,0.06)",
                    }}>
                        <span style={{ color: a.level === "CRITICAL" ? C.red : C.amber }} className="mt-0.5 shrink-0">
                          {a.level === "CRITICAL" ? "!!" : "!"}
                        </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold" style={{ color: a.level === "CRITICAL" ? C.red : C.amber }}>{a.level === "CRITICAL" ? "심각" : "경고"}</span>
                        <span className="text-white/30 text-xs">{a.category}</span>
                        {a.service && (
                          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/45 text-[10px] font-mono">
                            {a.service}
                          </span>
                        )}
                      </div>
                      <p className="text-white/80">{a.message}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {a.owner && (
                          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/55 text-[10px]">
                            담당 {a.owner}
                          </span>
                        )}
                        {a.source && (
                          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/55 text-[10px]">
                            출처 {a.source}
                          </span>
                        )}
                        {a.signal && (
                          <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/55 text-[10px] font-mono">
                            {a.signal}
                          </span>
                        )}
                      </div>
                      {a.runbook && (
                        <p className="text-white/35 text-xs mt-2">런북: {a.runbook}</p>
                      )}
                      <p className="text-white/40 text-xs mt-1">조치: {a.action}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Worker groups */}
            {[
              { title: "뉴스 파이프라인", workers: ["news-producer", "news-consumer", "elastic-consumer"], tip: "뉴스 수집, MongoDB 저장, Elasticsearch 색인 흐름입니다." },
              { title: "시세 파이프라인", workers: ["price-producer", "price-consumer"], tip: "실시간 시세 수집과 저장 흐름입니다." },
              { title: "기타 워커",      workers: ["email-worker", "ocr-worker"], tip: "알림과 OCR 지원 작업입니다." },
            ].map(group => (
              <div key={group.title}>
                <SectionTitle>{group.title}<Info tip={group.tip} /></SectionTitle>
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
                            {(wdata?.downtime_sec ?? 0) > 0
                              ? <span>중단 시간 <span className="text-amber-400 font-bold">{wdata!.downtime_sec < 60 ? `${wdata!.downtime_sec}초` : `${Math.round(wdata!.downtime_sec / 60)}분`}</span></span>
                              : <span className="text-white/20">중단 없음</span>}
                            {wdata?.start_time && wdata.start_time !== "-" && (
                              <span>시작 <span className="text-white/60">{new Date(wdata.start_time).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span></span>
                            )}
                          </div>
                        )}
                        {/* 理쒓렐 濡쒓렇 */}
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

            {/* Data stores 쨌 backup summary (details in Data / Backup tabs) */}
            <div>
              <SectionTitle>데이터 저장소 상태 <span className="normal-case tracking-normal text-white/20 font-normal">상세 내용은 데이터 / 백업 탭을 참고하세요</span></SectionTitle>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <p className="text-xs text-white/40 mb-2">MongoDB</p>
                  {loadingPipeline ? <Skel h="h-8" /> : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">전체 뉴스</span>
                        <span className="font-mono font-bold" style={{ color: C.emerald }}>{pipeline?.mongodb.available ? (pipeline.mongodb.news_total ?? "없음").toLocaleString() : "없음"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">최근 1시간 추가</span>
                        <span className="font-mono" style={{ color: C.blue }}>{pipeline?.mongodb.available ? `+${pipeline.mongodb.news_last_1h}` : "없음"}</span>
                      </div>
                    </div>
                  )}
                </Card>
                <Card>
                  <p className="text-xs text-white/40 mb-2">Elasticsearch</p>
                  {loadingPipeline ? <Skel h="h-8" /> : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">색인 문서 수</span>
                        <span className="font-mono font-bold" style={{ color: C.violet }}>{pipeline?.elasticsearch.available ? (pipeline.elasticsearch.news_docs ?? "없음").toLocaleString() : "없음"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">동기화 비율</span>
                        <span className="font-mono" style={{ color: C.cyan }}>
                          {pipeline?.elasticsearch.available && pipeline?.mongodb.available && pipeline.mongodb.news_total > 0
                            ? `${Math.round(pipeline.elasticsearch.news_docs / pipeline.mongodb.news_total * 100)}%`
                            : "없음"}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>
                <Card>
                  <p className="text-xs text-white/40 mb-2">Kafka</p>
                  {loadingDataM ? <Skel h="h-8" /> : !dataMetrics?.kafka.available ? (
                    <p className="text-xs text-white/20">메트릭 없음</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">컨슈머 적체</span>
                        <span className="font-mono font-bold" style={{ color: (dataMetrics.kafka.consumer_lag ?? 0) > 100 ? C.amber : C.emerald }}>{dataMetrics.kafka.consumer_lag ?? "없음"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">분당 처리량</span>
                        <span className="font-mono" style={{ color: C.blue }}><Val v={dataMetrics.kafka.throughput_msg_per_min} unit="" decimals={0} /></span>
                      </div>
                    </div>
                  )}
                </Card>
                <Card>
                  <p className="text-xs text-white/40 mb-2">백업 요약</p>
                  {loadingBackup ? <Skel h="h-8" /> : !backupStatus ? (
                    <p className="text-xs text-white/20">조회 실패</p>
                  ) : (
                    <div className="space-y-1.5">
                      {backupStatus.map(b => {
                        const sc = b.status === "OK" ? C.emerald : b.status === "ERROR" ? C.red : b.status === "RUNNING" ? C.blue : C.amber;
                        return (
                          <div key={b.name} className="flex items-center justify-between text-xs">
                            <span className="text-white/40 truncate">{b.name.replace("-backup", "")}</span>
                            <span className="font-bold font-mono" style={{ color: sc }}>{translateStatus(b.status)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            </div>

            {/* AI 遺꾩꽍 */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>파이프라인 AI 분석<Info tip={"Claude가 워커 상태와 MongoDB, Elasticsearch, Redis, Kafka 신호를 함께 검토합니다.\n흐름 중단, 멈춘 컨슈머, 적재 지연을 빠르게 파악할 때 유용합니다."} /></SectionTitle>
                <button onClick={runPipelineDiag} disabled={loadingPDiag}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-400/30 bg-violet-400/10 text-violet-400 hover:bg-violet-400/20 transition disabled:opacity-50">
                  {loadingPDiag ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              {!pipelineDiag && !loadingPDiag && (
                <Card className="text-center py-8 text-white/20 text-sm">AI 분석을 실행하면 파이프라인 결과가 표시됩니다.</Card>
              )}
              {loadingPDiag && <Card><Skel h="h-32" /></Card>}
              {pipelineDiag && !loadingPDiag && (() => {
                const c = SevColors(pipelineDiag.overall);
                return (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                      <span className={`text-xs font-semibold ${c.text}`}>종합 상태: {DIAG_SEVERITY_LABELS[pipelineDiag.overall]}</span>
                    </div>
                    {(pipelineDiag.components || []).map(comp => {
                      const cc = comp.status === "ERROR" ? SevColors("CRITICAL") : comp.status === "WARN" ? SevColors("WARN") : SevColors("OK");
                      const meta = WORKER_META[comp.name];
                      return (
                        <Card key={comp.name} className={`${cc.bg} ${cc.border}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span>{meta?.icon ?? "AI"}</span>
                              <span className="text-sm font-semibold">{comp.label || comp.name}</span>
                            </div>
                            <StatusBadge status={comp.status} />
                          </div>
                          <p className="text-xs text-white/60 mb-2">{comp.summary}</p>
                          {comp.issues.length > 0 && (
                            <div className="space-y-1">
                              {comp.issues.map((iss, i) => (
                                <p key={i} className="text-xs text-amber-400">이슈: {iss.title}: {iss.detail}</p>
                              ))}
                            </div>
                          )}
                          {comp.actions.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {comp.actions.map((a, i) => (
                                <p key={i} className="text-xs text-white/40">조치: {a.action}</p>
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
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: DATA
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "data" && (
          <div className="space-y-6">

            {/* Data store cards */}
            <div>
              <SectionTitle>데이터 저장소</SectionTitle>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* MongoDB */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">MongoDB<Info tip={"뉴스, 자산, 사용자 데이터를 저장하는 원문 저장소입니다.\n전체 뉴스는 clouddx.news 문서 수 기준입니다.\n최근 1시간 추가 건수는 published_at 기준입니다.\n초당 읽기/쓰기 수는 serverStatus 변화량 기준입니다."} /></p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">전체 뉴스</span>
                        <span className="font-mono font-bold text-lg" style={{ color: C.emerald }}>
                          {pipeline?.mongodb.available ? (pipeline.mongodb.news_total ?? "없음").toLocaleString() : "없음"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">최근 1시간 추가</span>
                        <span className="font-mono" style={{ color: C.blue }}>
                          {pipeline?.mongodb.available ? `+${pipeline.mongodb.news_last_1h}` : "없음"}
                        </span>
                      </div>
                    </div>
                    {dataMetrics?.mongodb.available && (
                      <div className="pt-2 border-t border-white/[0.06] space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">연결 수</span>
                          <span className="font-mono font-bold" style={{ color: (dataMetrics.mongodb.connections ?? 0) > 100 ? C.amber : C.emerald }}>
                            {dataMetrics.mongodb.connections ?? "없음"}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">초당 읽기/쓰기</span>
                          <span className="font-mono text-xs" style={{ color: C.cyan }}>
                            {dataMetrics.mongodb.ops_read_per_sec != null
                              ? `${dataMetrics.mongodb.ops_read_per_sec.toFixed(1)} / ${(dataMetrics.mongodb.ops_write_per_sec ?? 0).toFixed(1)}`
                              : <span className="text-white/20">-</span>}
                          </span>
                        </div>
                        {((dataMetrics.mongodb.queued_readers ?? 0) + (dataMetrics.mongodb.queued_writers ?? 0)) > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-white/50">대기 중 (읽기/쓰기)</span>
                            <span className="font-mono font-bold" style={{ color: C.amber }}>
                              {dataMetrics.mongodb.queued_readers ?? 0} / {dataMetrics.mongodb.queued_writers ?? 0}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>

                {/* Elasticsearch */}
                <Card>
                  <p className="text-xs text-white/40 mb-3">Elasticsearch<Info tip={"뉴스 검색용 전체 텍스트 인덱스입니다.\nJVM Heap 80% 초과는 GC 압박 신호일 수 있습니다.\n인덱스 크기는 실제 저장 데이터 크기입니다.\n검색 지연 100ms 초과는 튜닝이 필요할 수 있습니다.\nRejected는 쓰기 스레드풀이 과부하된 상태를 뜻합니다."} /></p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">색인 문서 수</span>
                      <span className="font-mono font-bold text-lg" style={{ color: C.violet }}>
                        {pipeline?.elasticsearch.available ? (pipeline.elasticsearch.news_docs ?? "없음").toLocaleString() : "없음"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">동기화 비율</span>
                      <span className="font-mono" style={{ color: C.cyan }}>
                        {pipeline?.elasticsearch.available && pipeline?.mongodb.available && pipeline.mongodb.news_total > 0
                          ? `${Math.round(pipeline.elasticsearch.news_docs / pipeline.mongodb.news_total * 100)}%`
                          : "없음"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">JVM 힙</span>
                      <span className="font-mono" style={{ color: (dataMetrics?.elasticsearch.jvm_heap_pct ?? 0) > 80 ? C.red : C.emerald }}>
                        {dataMetrics?.elasticsearch.jvm_heap_pct != null
                          ? <>{dataMetrics.elasticsearch.jvm_heap_pct.toFixed(0)}%{dataMetrics.elasticsearch.jvm_heap_used_gb != null && <span className="text-white/30 text-xs ml-1">({dataMetrics.elasticsearch.jvm_heap_used_gb.toFixed(1)} / {dataMetrics.elasticsearch.jvm_heap_max_gb?.toFixed(1)} GB)</span>}</>
                          : <span className="text-white/20">exporter not deployed</span>}
                      </span>
                    </div>
                    {dataMetrics?.elasticsearch.store_gb != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">인덱스 크기</span>
                        <span className="font-mono" style={{ color: C.cyan }}><Val v={dataMetrics.elasticsearch.store_gb} unit=" GB" decimals={1} /></span>
                      </div>
                    )}
                    {dataMetrics?.elasticsearch.search_qps != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">검색 QPS</span>
                        <span className="font-mono" style={{ color: C.violet }}><Val v={dataMetrics.elasticsearch.search_qps} unit="" decimals={2} /></span>
                      </div>
                    )}
                    {dataMetrics?.elasticsearch.search_latency_ms != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">검색 지연</span>
                        <span className="font-mono" style={{ color: dataMetrics.elasticsearch.search_latency_ms > 100 ? C.amber : C.emerald }}><Val v={dataMetrics.elasticsearch.search_latency_ms} unit=" ms" decimals={1} /></span>
                      </div>
                    )}
                    {(dataMetrics?.elasticsearch.thread_rejected ?? 0) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">거절 건수</span>
                        <span className="font-mono font-bold" style={{ color: C.red }}>{dataMetrics!.elasticsearch.thread_rejected}</span>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Redis + Kafka */}
                <div className="space-y-4">
                  <Card>
                    <p className="text-xs text-white/40 mb-3">Redis<Info tip={"API 캐시, 세션, OAuth 상태 저장소입니다.\n적중률이 80% 미만이면 캐시 미스가 잦을 수 있습니다.\n연결 수 급증은 커넥션 풀 압박 신호일 수 있습니다.\n메모리가 가득 차면 축출로 캐시가 유실될 수 있습니다."} /></p>
                    {loadingDataM ? <Skel h="h-12" /> : !dataMetrics?.redis.available ? (
                      <p className="text-xs text-white/20">메트릭 없음</p>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">연결 수</span>
                          <span className="font-mono font-bold" style={{ color: (dataMetrics.redis.clients ?? 0) > 50 ? C.amber : C.emerald }}>{dataMetrics.redis.clients ?? "없음"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">적중률</span>
                          <span className="font-mono" style={{ color: (dataMetrics.redis.hit_rate_pct ?? 0) < 80 ? C.amber : C.emerald }}><Val v={dataMetrics.redis.hit_rate_pct} unit="%" decimals={1} /></span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">메모리</span>
                          <span className="font-mono text-xs" style={{ color: C.blue }}>
                            {dataMetrics.redis.memory_used_gb != null && dataMetrics.redis.memory_max_gb != null
                              ? `${dataMetrics.redis.memory_used_gb.toFixed(2)} / ${dataMetrics.redis.memory_max_gb.toFixed(1)} GB`
                              : dataMetrics.redis.memory_pct != null
                                ? <Val v={dataMetrics.redis.memory_pct} unit="%" decimals={0} />
                                : <span className="text-white/20">없음</span>}
                          </span>
                        </div>
                      </div>
                    )}
                  </Card>
                  <Card>
                    <p className="text-xs text-white/40 mb-3">Kafka<Info tip={"뉴스와 시세 파이프라인용 메시지 브로커입니다.\n컨슈머 적체가 500을 넘으면 경고 수준입니다.\n분당 처리량은 파티션 오프셋 증가량 기준입니다.\n처리량이 없는데 적체가 쌓이면 컨슈머 장애 가능성이 큽니다."} /></p>
                    {loadingDataM ? <Skel h="h-12" /> : !dataMetrics?.kafka.available ? (
                      <p className="text-xs text-white/20">메트릭 없음</p>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">컨슈머 적체</span>
                          <span className="font-mono font-bold text-lg" style={{ color: (dataMetrics.kafka.consumer_lag ?? 0) > 500 ? C.red : (dataMetrics.kafka.consumer_lag ?? 0) > 100 ? C.amber : C.emerald }}>
                            {dataMetrics.kafka.consumer_lag ?? "없음"}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-white/50">분당 처리량</span>
                          <span className="font-mono" style={{ color: C.blue }}><Val v={dataMetrics.kafka.throughput_msg_per_min} unit=" msg" decimals={0} /></span>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            </div>

            {/* Disk usage by node */}
            <div>
              <SectionTitle>디스크 사용량 | 노드별</SectionTitle>
              {loadingDataM ? <Skel h="h-48" /> : !dataMetrics?.disk?.available ? (
                <Card><p className="text-xs text-white/20">node_exporter가 배포되지 않았거나 메트릭이 없습니다</p></Card>
              ) : (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card className="text-center">
                      <p className="text-xs text-white/40 mb-1">전체 사용률</p>
                      <p className="text-2xl font-mono font-bold" style={{ color: (dataMetrics.disk.used_pct ?? 0) >= 85 ? C.red : (dataMetrics.disk.used_pct ?? 0) >= 70 ? C.amber : C.emerald }}>
                        {dataMetrics.disk.used_pct?.toFixed(1) ?? "없음"}<span className="text-sm text-white/40">%</span>
                      </p>
                    </Card>
                    <Card className="text-center">
                      <p className="text-xs text-white/40 mb-1">사용 / 전체</p>
                      <p className="text-sm font-mono font-bold" style={{ color: C.blue }}>
                        {dataMetrics.disk.used_gb?.toFixed(0) ?? "-"} <span className="text-white/30 font-normal">/ {dataMetrics.disk.total_gb?.toFixed(0) ?? "-"} GB</span>
                      </p>
                    </Card>
                    <Card className="text-center">
                      <p className="text-xs text-white/40 mb-1">읽기 I/O</p>
                      <p className="text-sm font-mono font-bold" style={{ color: C.cyan }}>{dataMetrics.disk.read_mbps?.toFixed(1) ?? "-"} <span className="text-white/40 text-xs font-normal">MB/s</span></p>
                    </Card>
                    <Card className="text-center">
                      <p className="text-xs text-white/40 mb-1">쓰기 I/O</p>
                      <p className="text-sm font-mono font-bold" style={{ color: C.cyan }}>{dataMetrics.disk.write_mbps?.toFixed(1) ?? "-"} <span className="text-white/40 text-xs font-normal">MB/s</span></p>
                    </Card>
                  </div>

                  {missingDiskNodeNames.length > 0 && (
                    <Card className="border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs text-amber-300">
                        node_exporter 디스크 메트릭 누락: {missingDiskNodeNames.join(", ")}
                      </p>
                    </Card>
                  )}

                  {/* Per-node bars */}
                  {diskNodeRows.length > 0 && (
                    <Card>
                      <div className="space-y-4">
                        {diskNodeRows.map(n => {
                          const hasMetrics = !n.missing;
                          const barColor = !hasMetrics ? C.slate : n.used_pct >= 85 ? C.red : n.used_pct >= 70 ? C.amber : C.emerald;
                          return (
                            <div key={`${n.node_name}-${n.hostname}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="font-mono text-sm font-semibold text-white/80">{n.node_name || n.hostname}</span>
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-white/40">
                                    {hasMetrics ? `${n.used_gb.toFixed(1)} / ${n.total_gb.toFixed(1)} GB` : "메트릭 없음"}
                                  </span>
                                  <span className="font-mono font-bold w-14 text-right" style={{ color: barColor }}>
                                    {hasMetrics ? `${n.used_pct.toFixed(1)}%` : "-"}
                                  </span>
                                </div>
                              </div>
                              <div className="w-full h-2.5 rounded-full bg-white/10">
                                <div className="h-2.5 rounded-full transition-all duration-500" style={{ width: hasMetrics ? `${Math.min(n.used_pct, 100)}%` : "0%", background: barColor }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 pt-3 border-t border-white/[0.06] flex gap-5 text-xs text-white/30">
                        <span><span style={{ color: C.emerald }}>정상</span> &lt;70%</span>
                        <span><span style={{ color: C.amber }}>경고</span> 70-85%</span>
                        <span><span style={{ color: C.red }}>심각</span> &gt;85%</span>
                        <span><span style={{ color: C.slate }}>메트릭 없음</span></span>
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </div>

            {/* AI analysis */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>AI 분석<Info tip={"Claude가 ES, Redis, Kafka, MongoDB, 디스크 메트릭을 함께 분석합니다.\n이상 징후, 용량 위험, 성능 저하를 탐지하며 실시간 진단은 약 5~10초 정도 걸립니다."} /></SectionTitle>
                <button onClick={() => runTabDiag("data", "data-diagnose")} disabled={tabDiag["data"]?.loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                  {tabDiag["data"]?.loading ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              <DiagPanel diag={tabDiag["data"]?.result ?? null} loading={tabDiag["data"]?.loading ?? false} />
            </div>
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: BACKUP
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "backup" && (
          <div className="space-y-6">
            <div>
              <SectionTitle>백업 상태<Info tip={"CronJob 실행 이력과 현재 상태를 보여줍니다.\nOK는 마지막 작업 성공, NO_RUN은 아직 미실행, ERROR는 마지막 작업 실패, RUNNING은 현재 실행 중을 의미합니다."} /></SectionTitle>
              {loadingBackup ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><Skel h="h-48" /><Skel h="h-48" /><Skel h="h-48" /></div>
              ) : !backupStatus ? (
                <Card><p className="text-xs text-white/20">백업 상태를 불러오지 못했습니다. RBAC 권한을 확인하세요.</p></Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {backupStatus.map(b => {
                    const statusColor = b.status === "OK" ? C.emerald : b.status === "ERROR" ? C.red : b.status === "RUNNING" ? C.blue : C.amber;
                    const fmtTime = (s: string|null) => s
                      ? new Date(s).toLocaleString("ko-KR", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12: false })
                      : "-";
                    const icons: Record<string, string> = { "mongodb-backup": "MG", "elasticsearch-backup": "ES", "etcd-backup": "ET" };
                    return (
                      <Card key={b.name}>
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-sm font-medium text-white/70">{icons[b.name] ?? "BK"} {b.name}</p>
                          <span className="text-sm font-bold px-3 py-1 rounded-full" style={{ color: statusColor, background: `${statusColor}22` }}>
                            {translateStatus(b.status)}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-white/40">네임스페이스</span>
                            <span className="font-mono text-white/50">{b.namespace}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/40">스케줄</span>
                            <span className="font-mono text-white/60">{b.schedule ?? "-"}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/40">최근 실행</span>
                            <span className="font-mono text-white/50">{fmtTime(b.last_run_at)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/40">최근 성공</span>
                            <span className="font-mono" style={{ color: b.last_success_at ? C.emerald : C.amber }}>{fmtTime(b.last_success_at)}</span>
                          </div>
                          {b.last_error && (
                            <div className="mt-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                              <p className="text-xs text-white/40 mb-1">오류 메시지</p>
                              <p className="text-xs text-red-400 break-words leading-relaxed">{b.last_error}</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* AI analysis */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>AI 분석<Info tip={"Claude가 백업 CronJob 결과를 분석합니다.\n실패 원인, 예방 조치, 스케줄 위험을 요약하며 실시간 진단은 약 5~10초 정도 걸립니다."} /></SectionTitle>
                <button onClick={() => runTabDiag("backup", "backup-diagnose")} disabled={tabDiag["backup"]?.loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                  {tabDiag["backup"]?.loading ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              <DiagPanel diag={tabDiag["backup"]?.result ?? null} loading={tabDiag["backup"]?.loading ?? false} />
            </div>
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: LOGS
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "심각", value: logSeverityCounts.critical, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                { label: "경고", value: logSeverityCounts.warn, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                { label: "정보", value: logSeverityCounts.info, color: "text-slate-300", bg: "bg-slate-500/10 border-slate-500/20" },
                { label: "추적 연결", value: logSeverityCounts.trace_linked, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
              ].map(item => (
                <Card key={item.label} className={`py-3 ${item.bg}`}>
                  <p className="text-[11px] uppercase tracking-widest text-white/40">{item.label}</p>
                  <p className={`mt-2 text-2xl font-semibold ${item.color}`}>{item.value}</p>
                </Card>
              ))}
            </div>

            {/* ?먮윭 ?대젰 ?붿빟 ??理쒓렐 1?쒓컙, ?뚮뱶蹂?ERROR 嫄댁닔 */}
            {errorSummary.length > 0 && (
              <Card className="border border-red-500/20">
                <SectionTitle>
                  오류 로그 요약 (최근 1시간)
                  <Info tip={"최근 1시간 ERROR 로그를 파드별로 집계한 표입니다.\n심각도는 요청 상태와 메시지 패턴을 함께 보고 분류합니다.\n추적이 연결된 행은 아래 실시간 로그 목록에서 바로 조사할 수 있습니다."} />
                </SectionTitle>
                <table className="w-full text-xs mt-2">
                  <thead>
                    <tr className="text-white/30 text-left border-b border-white/[0.06]">
                      {["파드", "네임스페이스", "오류 수", "심각도", "추적 연결", "최근 발생", "최근 메시지"].map(h => (
                        <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {errorSummary.map((s, i) => (
                      <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition"
                          onClick={() => setLogPod(s.pod)}>
                        <td className="py-1.5 pr-4 font-mono text-white/70 truncate max-w-[160px]" title={s.pod}>{s.pod}</td>
                        <td className="py-1.5 pr-4 text-white/30">{s.namespace}</td>
                        <td className="py-1.5 pr-4">
                          <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">{s.count}</span>
                        </td>
                        <td className="py-1.5 pr-4">
                          <LogSeverityBadge severity={s.top_severity ?? "WARN"} />
                        </td>
                        <td className="py-1.5 pr-4 text-white/50">{s.traceable_count ?? 0}</td>
                        <td className="py-1.5 pr-4 font-mono text-white/40">{s.last_time}</td>
                        <td className="py-1.5 text-white/40 truncate max-w-[240px]" title={s.last_msg}>{s.last_msg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              {(["tutum-app", "tutum-data", "all"] as const).map(ns => (
                <button key={ns} onClick={() => setLogNs(ns)}
                        className={`px-3 py-1 rounded-lg text-xs border transition ${
                          logNs === ns ? "border-blue-400/50 bg-blue-400/10 text-blue-400" : "border-white/[0.08] text-white/40 hover:text-white/60"
                        }`}>{ns === "all" ? "전체" : ns}</button>
              ))}
              <div className="w-px bg-white/10" />
              {(["ALL", "CRITICAL", "WARN", "INFO"] as const).map(sev => (
                <button key={sev} onClick={() => setLogSeverity(sev)}
                        className={`px-3 py-1 rounded-lg text-xs border transition ${
                          logSeverity === sev ? "border-blue-400/50 bg-blue-400/10 text-blue-400" : "border-white/[0.08] text-white/40 hover:text-white/60"
                        }`}>{sev === "ALL" ? "전체" : LOG_SEVERITY_LABELS[sev as LogSeverity]}</button>
              ))}
              <div className="w-px bg-white/10" />
              {(["ALL", "INFO", "WARN", "ERROR"] as const).map(lv => (
                <button key={lv} onClick={() => setLogLevel(lv)}
                        className={`px-3 py-1 rounded-lg text-xs border transition ${
                          logLevel === lv ? "border-blue-400/50 bg-blue-400/10 text-blue-400" : "border-white/[0.08] text-white/40 hover:text-white/60"
                        }`}>{lv === "ALL" ? "전체" : LOG_LEVEL_LABELS[lv] ?? lv}</button>
              ))}
              <input value={logPod} onChange={e => setLogPod(e.target.value)} placeholder="파드 이름으로 필터"
                     className="px-3 py-1 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-white/70 outline-none placeholder-white/20 w-40" />
            </div>

            <Card className="p-0 overflow-hidden">
              <div ref={logRef} className="h-[60vh] overflow-y-auto font-mono text-[11px] leading-5">
                {loadingLogs ? (
                  <div className="p-4 space-y-2">{[...Array(12)].map((_, i) => <Skel key={i} h="h-4" />)}</div>
                ) : filteredLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-white/20">로그가 없습니다</div>
                ) : (
                  filteredLogs.map((log, i) => {
                    const severity = log.severity ?? "INFO";
                    return (
                      <div
                        key={i}
                        onClick={() => setLogPod(log.pod)}
                        className={`flex items-start gap-3 px-4 py-1 border-b border-white/[0.03] hover:bg-white/[0.025] transition cursor-pointer ${
                          severity === "CRITICAL" ? "bg-red-500/[0.04]" : severity === "WARN" ? "bg-amber-500/[0.03]" : ""
                        }`}
                      >
                        <span className="text-white/25 shrink-0 w-16">{log.time}</span>
                        <LogLevelBadge level={log.level} />
                        <div className="shrink-0 pt-0.5">
                          <LogSeverityBadge severity={severity} />
                        </div>
                        <span className="text-white/25 shrink-0 hidden lg:inline w-28 truncate" title={log.pod}>{log.pod}</span>
                        <span className="text-white/60 break-all flex-1">{log.msg}</span>
                        {log.trace_url && (
                          <a
                            href={log.trace_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-[10px] text-blue-400 hover:underline border border-blue-400/20 rounded px-2 py-0.5"
                            title={log.trace_id ?? "추적 열기"}
                          >
                            추적
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="px-4 py-2 border-t border-white/[0.06] text-xs text-white/30">
                {filteredLogs.length}건 | 10초 자동 새로고침
              </div>
            </Card>

            {/* AI 遺꾩꽍 */}
            {SHOW_LEGACY_TAB_AI && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>AI 분석<Info tip={"Claude가 최근 1시간 로그 패턴을 분석합니다.\n반복 오류, 노이즈가 많은 파드, 추정 가능한 원인을 빠르게 요약할 때 유용합니다."} /></SectionTitle>
                <button onClick={() => runTabDiag("logs", "log-diagnose")} disabled={tabDiag["logs"]?.loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                  {tabDiag["logs"]?.loading ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              <DiagPanel diag={tabDiag["logs"]?.result ?? null} loading={tabDiag["logs"]?.loading ?? false} />
            </div>
            )}
          </div>
        )}

        {/* ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
            TAB: TRACES
        ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧 */}
        {activeTab === "traces" && (() => {
          const TraceTable = ({ rows, emptyMsg }: { rows: TraceEntry[]; emptyMsg: string }) => (
            rows.length === 0
              ? <p className="text-xs text-white/20 py-4 text-center">{emptyMsg}</p>
              : <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/30 text-left border-b border-white/[0.06] bg-white/[0.02]">
                        {["상태", "지속 시간", "엔드포인트(경로)", "추적 ID", "시간"].map(h => (
                          <th key={h} className="px-3 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(t => {
                        const dColor = t.durationMs > 500 ? C.red : t.durationMs > 200 ? C.amber : C.emerald;
                        const ts = new Date(t.startTimeMs).toLocaleTimeString("ko-KR", { hour12: false });
                        return (
                          <tr key={t.traceID} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition ${t.isError ? "bg-red-500/[0.04]" : ""}`}>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.isError ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                                {t.isError ? "5xx" : "정상"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-mono font-bold" style={{ color: dColor }}>{t.durationMs}ms</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-white/70 max-w-[280px] truncate" title={t.rootTraceName}>
                              {t.rootTraceName}
                            </td>
                            <td className="px-3 py-2">
                              <a href={t.grafana_url} target="_blank" rel="noopener noreferrer"
                                 className="font-mono text-blue-400 hover:underline truncate block max-w-[120px]" title="Grafana Tempo에서 전체 추적 보기">
                                {t.traceID.slice(0, 14)}...
                              </a>
                            </td>
                            <td className="px-3 py-2 text-white/30 font-mono">{ts}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
          );

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/40">최근 1시간 tutum-backend 추적 데이터, 60초마다 갱신</p>
                <a href={`${GRAFANA}/explore`} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-blue-400 hover:underline">Grafana Tempo 열기</a>
              </div>

              {loadingTraces ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <Skel key={i} h="h-8" />)}</div>
              ) : !tracesData?.available ? (
                <Card>
                  <div className="h-32 flex flex-col items-center justify-center text-white/20 gap-2">
                    <span className="text-3xl">TR</span>
                    <p className="text-sm">Tempo 연결을 사용할 수 없습니다</p>
                    <p className="text-xs text-white/15">추적 파이프라인, Alloy, Tempo 연결 상태를 확인하세요.</p>
                  </div>
                </Card>
              ) : (
                <>
                  {/* 5xx ?먮윭 ?몃젅?댁뒪 ??"?대뵒???딄꼈?붿?" ?듭떖 */}
                  <Card className="border border-red-500/20 p-0 overflow-hidden">
                    <div className="px-4 pt-3 pb-2 border-b border-white/[0.04]">
                      <SectionTitle>
                        서버 오류 추적 (5xx)
                        <Info tip={"백엔드 서비스에서 발생한 최근 서버 오류 추적입니다."} />
                      </SectionTitle>
                    </div>
                    <div className="px-4 pb-3">
                      <TraceTable rows={tracesData.error_traces} emptyMsg="최근 5xx 추적이 없습니다." />
                    </div>
                  </Card>

                  {/* 4xx ?대씪?댁뼵???먮윭 */}
                  {(tracesData.client_error_traces?.length ?? 0) > 0 && (
                    <Card className="border border-amber-500/20 p-0 overflow-hidden">
                      <div className="px-4 pt-3 pb-2 border-b border-white/[0.04]">
                        <SectionTitle>
                          클라이언트 오류 추적 (4xx)
                          <Info tip={"최근 클라이언트 측 오류 추적입니다."} />
                        </SectionTitle>
                      </div>
                      <div className="px-4 pb-3">
                        <TraceTable rows={tracesData.client_error_traces} emptyMsg="최근 4xx 추적이 없습니다." />
                      </div>
                    </Card>
                  )}

                  {/* ?먮┛ ?붿껌 ?꾩껜 */}
                  <Card className="p-0 overflow-hidden">
                    <div className="px-4 pt-3 pb-2 border-b border-white/[0.04]">
                      <SectionTitle>
                        전체 추적 (50ms 이상)
                        <Info tip={"50ms보다 느린 모든 요청 추적입니다."} />
                      </SectionTitle>
                    </div>
                    <div className="px-4 pb-3">
                      <TraceTable rows={tracesData.traces} emptyMsg="50ms 이상 느린 추적이 없습니다." />
                    </div>
                  </Card>
                </>
              )}

              {/* AI 遺꾩꽍 */}
              {SHOW_LEGACY_TAB_AI && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionTitle>AI 분석<Info tip={"Claude가 최근 추적 데이터, 지연 급증 구간, 오류 경로를 분석합니다.\n어느 지점에 느리거나 실패한 요청이 집중되는지 설명할 때 유용합니다."} /></SectionTitle>
                  <button onClick={() => runTabDiag("traces", "trace-diagnose")} disabled={tabDiag["traces"]?.loading}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition disabled:opacity-50">
                    {tabDiag["traces"]?.loading ? "분석 중..." : "AI 분석"}
                  </button>
                </div>
                <DiagPanel diag={tabDiag["traces"]?.result ?? null} loading={tabDiag["traces"]?.loading ?? false} />
              </div>
              )}
            </div>
          );
        })()}

      </main>
    </div>
  );
}
