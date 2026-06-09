/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from "recharts";
import { 
  Shield, 
  Activity, 
  Cpu, 
  Terminal, 
  Settings, 
  Flame, 
  Clock, 
  BarChart2, 
  ShieldAlert, 
  ArrowRight,
  Compass,
  Server,
  Database,
  Lock,
  Unlock,
  User,
  Download,
  LogOut,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface TelemetryMetrics {
  opm: number;
  currentRate: number;
  mean: number;
  std: number;
  z_score: number;
  status: string;
  active_threats: number;
}

interface TimelineEntry {
  sec: number;
  time: string;
  count: number;
}

interface AnomalyRecord {
  id: number;
  timestamp: number;
  z_score: number;
  window_mean: number;
  window_std: number;
  event_count: number;
  status: string;
  diagnosis: string;
}

interface AgentLog {
  id: number;
  anomaly_id: number;
  timestamp: number;
  step: number;
  type: string;
  content: string;
}

export default function App() {
  const [metrics, setMetrics] = useState<TelemetryMetrics>({
    opm: 0,
    currentRate: 0,
    mean: 0,
    std: 0,
    z_score: 0.0,
    status: "Steady State",
    active_threats: 0,
  });

  const [history, setHistory] = useState<TimelineEntry[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [selectedAnomalyId, setSelectedAnomalyId] = useState<number | null>(null);
  const [traces, setTraces] = useState<AgentLog[]>([]);
  const [isSpikeTriggering, setIsSpikeTriggering] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  // Authentication States
  const [userRole, setUserRole] = useState<'admin' | 'organization' | null>(() => {
    return (localStorage.getItem("aegis_user_role") as 'admin' | 'organization' | null) || null;
  });
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showComplianceDetail, setShowComplianceDetail] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");

    setTimeout(() => {
      const u = loginUsername.trim().toLowerCase();
      const p = loginPassword;

      if (u === "admin" && p === "admin123") {
        localStorage.setItem("aegis_user_role", "admin");
        setUserRole("admin");
        setLoginError("");
      } else if ((u === "organization" || u === "org") && p === "org123") {
        localStorage.setItem("aegis_user_role", "organization");
        setUserRole("organization");
        setLoginError("");
      } else {
        setLoginError("AUTHENTICATION FAILURE: INVALID CORRELATION CREDENTIALS.");
      }
      setIsLoggingIn(false);
    }, 400);
  };

  const handleQuickLogin = (role: 'admin' | 'organization') => {
    localStorage.setItem("aegis_user_role", role);
    setUserRole(role);
  };

  const handleLogout = () => {
    localStorage.removeItem("aegis_user_role");
    setUserRole(null);
    setLoginUsername("");
    setLoginPassword("");
    setLoginError("");
    setShowComplianceDetail(false);
  };

  // Configuration sliders
  const [windowSize, setWindowSize] = useState<number>(60);
  const [zScoreThresh, setZScoreThresh] = useState<number>(3.0);
  const [eventInterval, setEventInterval] = useState<number>(200);

  // Simulated running Uptime counter
  const [uptime, setUptime] = useState("000:00:00:00");

  useEffect(() => {
    const startEpoch = Date.now() - 172800000; // simulated 48 hours boot
    const clock = setInterval(() => {
      const elapsed = Date.now() - startEpoch;
      const days = Math.floor(elapsed / (24 * 3600 * 1000));
      const hours = Math.floor((elapsed % (24 * 3600 * 1000)) / (3600 * 1000));
      const mins = Math.floor((elapsed % (3600 * 1000)) / (60 * 1000));
      const secs = Math.floor((elapsed % (60 * 1000)) / 1000);
      setUptime(
        `${days.toString().padStart(3, "0")}:${hours
          .toString()
          .padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs
          .toString()
          .padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  // Poll server configurations on component mount
  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setWindowSize(data.WINDOW_SIZE || 60);
        setZScoreThresh(data.Z_SCORE_THRESHOLD || 3.0);
        setEventInterval(data.EVENT_INTERVAL || 200);
      })
      .catch(() => setIsConnected(false));
  }, []);

  // Poll live metrics, historical counts, and anomaly logs every 1s
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [metricsRes, historyRes, anomaliesRes] = await Promise.all([
          fetch("/api/metrics"),
          fetch("/api/history"),
          fetch("/api/anomalies"),
        ]);

        if (!metricsRes.ok || !historyRes.ok || !anomaliesRes.ok) {
          throw new Error("HTTP error polling endpoints");
        }

        const metricsData = await metricsRes.json();
        const historyData = await historyRes.json();
        const anomaliesData = await anomaliesRes.json();

        setMetrics(metricsData);
        setHistory(historyData);
        setAnomalies(anomaliesData);
        setIsConnected(true);

        // Auto-select latest anomaly if none selected or if currently viewing prior latest
        if (anomaliesData.length > 0) {
          if (selectedAnomalyId === null) {
            setSelectedAnomalyId(anomaliesData[0].id);
          }
        }
      } catch (err) {
        setIsConnected(false);
        console.error("Poller network mismatch:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, [selectedAnomalyId]);

  // Poll agent traces for the selected anomaly when selected
  useEffect(() => {
    if (selectedAnomalyId === null) return;
    
    const fetchTraces = async () => {
      try {
        const res = await fetch(`/api/traces/${selectedAnomalyId}`);
        if (!res.ok) return;
        const data = await res.json();
        setTraces(data);
      } catch (err) {
        console.error("Failed fetching agent logs:", err);
      }
    };

    fetchTraces();
    const interval = setInterval(fetchTraces, 1000);
    return () => clearInterval(interval);
  }, [selectedAnomalyId]);

  // Update backend settings of parameters
  const handleUpdateSettings = async (key: string, value: number) => {
    try {
      const payload: Record<string, number> = {};
      
      if (key === "window") {
        setWindowSize(value);
        payload.WINDOW_SIZE = value;
      } else if (key === "thresh") {
        setZScoreThresh(value);
        payload.Z_SCORE_THRESHOLD = value;
      } else if (key === "interval") {
        setEventInterval(value);
        payload.EVENT_INTERVAL = value;
      }

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("Failed persisting configs:", err);
    }
  };

  // Push manual simulation burst
  const handleTriggerSpike = async () => {
    if (isSpikeTriggering) return;
    setIsSpikeTriggering(true);
    try {
      const res = await fetch("/api/trigger-spike", { method: "POST" });
      if (res.ok) {
        setTimeout(() => setIsSpikeTriggering(false), 800);
      } else {
        setIsSpikeTriggering(false);
      }
    } catch (err) {
      setIsSpikeTriggering(false);
    }
  };

  const isBreachedStatus = metrics.status.includes("BREACH") || metrics.z_score > zScoreThresh;

  if (userRole === null) {
    return (
      <div id="aegis-login-portal" className="flex min-h-screen w-full items-center justify-center bg-[#050505] p-6 text-gray-200 font-sans select-none relative overflow-hidden">
        {/* Subtle decorative radial grid backgrounds */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.06),transparent_60%)] pointer-events-none" />
        <div className="absolute top-[20%] left-[20%] w-[400px] h-[400px] bg-red-950/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[20%] right-[20%] w-[400px] h-[400px] bg-blue-950/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="w-full max-w-xl bg-[#090909] border border-white/10 rounded-xl p-8 relative shadow-2xl space-y-6 z-10">
          
          {/* Header logo & title */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex h-14 w-14 items-center justify-center bg-[#0d0d0d] border border-red-500/30 text-red-500 rounded-lg shadow-[0_0_25px_rgba(239,68,68,0.15)] mb-2">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold tracking-widest uppercase text-white font-sans flex items-center gap-2">
              Aegis
            </h1>
            <p className="text-[11px] text-gray-400 max-w-sm tracking-wide">
              Secure Multi-Agent Anomaly Detection & Threat Prevention Gateway
            </p>
            <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-red-500/40 to-transparent mt-2" />
          </div>

          {/* Preset bypass credentials */}
          <div className="grid grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={() => handleQuickLogin("admin")}
              className="flex flex-col items-start gap-1 p-3.5 bg-[#0d0d0d] border border-white/5 hover:border-red-500/40 rounded-lg hover:bg-red-950/10 text-left transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-1.5 text-red-400 font-mono text-[10px] uppercase font-bold tracking-wider">
                <Lock className="w-3.5 h-3.5 text-red-500" /> Administrative Core
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed mt-1">Full parameter access, threat simulation & traces</p>
              <span className="text-[9px] text-gray-600 mt-1.5 font-mono group-hover:text-red-400 transition-colors">admin / admin123</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin("organization")}
              className="flex flex-col items-start gap-1 p-3.5 bg-[#0d0d0d] border border-white/5 hover:border-blue-500/40 rounded-lg hover:bg-blue-950/10 text-left transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-1.5 text-blue-400 font-mono text-[10px] uppercase font-bold tracking-wider">
                <Shield className="w-3.5 h-3.5 text-blue-500" /> Organization Portal
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed mt-1">Live streams view, database audit logs & governance</p>
              <span className="text-[9px] text-gray-600 mt-1.5 font-mono group-hover:text-blue-400 transition-colors">organization / org123</span>
            </button>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-gray-650 uppercase">
            <span className="h-[1px] bg-white/5 flex-1 mr-4" />
            <span className="text-gray-500">Or Authenticate Manually</span>
            <span className="h-[1px] bg-white/5 flex-1 ml-4" />
          </div>

          {/* Form Credentials */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-mono font-semibold">Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  required
                  placeholder="e.g. admin or organization"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg p-3 pl-10 text-xs focus:outline-none focus:border-red-500 text-white placeholder-gray-600 selection:bg-red-500/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-mono font-semibold">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg p-3 pl-10 text-xs focus:outline-none focus:border-red-500 text-white placeholder-gray-600 selection:bg-red-500/30"
                />
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-red-950/50 border border-red-500/30 rounded-lg text-[10px] font-mono text-red-400 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-500 animate-bounce shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white hover:text-white font-sans text-xs font-semibold py-3 px-4 rounded-lg tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(220,38,38,0.2)] disabled:cursor-not-allowed select-none active:scale-98 cursor-pointer"
            >
              {isLoggingIn ? "Validating security nodes..." : "Authorize Workspace Connection"}
            </button>
          </form>

          {/* Academic challenge profile badge info */}
          <div className="border-t border-white/5 pt-4 flex items-center justify-between text-[10px] text-gray-500 font-mono">
            <div>
              <p className="text-gray-400 uppercase font-semibold">Sigma Solutions Team</p>
              <p className="text-[9px] text-gray-600">AI Prototype Challenge Contenders</p>
            </div>
            <div className="text-right font-mono">
              <span className="bg-red-950/40 text-red-400 border border-red-500/20 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-xxs">
                Active Protocol
              </span>
            </div>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div id="aegis-root" className="flex h-screen w-full flex-col bg-[#050505] font-sans text-gray-200 overflow-hidden selection:bg-red-500/30 selection:text-red-200">
      
      {/* Top Technical Navigation Bar */}
      <header id="aegis-header" className="flex items-center justify-between border-b border-white/10 bg-[#0a0a0a] px-6 py-3 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-red-600 font-bold text-white shadow-[0_0_15px_rgba(220,38,38,0.5)]">
            A
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest uppercase text-white flex items-center gap-2">
              Aegis
              <span className={`ml-2 text-[10px] font-mono tracking-normal uppercase px-1.5 py-0.5 rounded ${
                isBreachedStatus 
                  ? "bg-red-950 text-red-500 border border-red-500/30 animate-pulse underline decoration-red-500/30" 
                  : "bg-emerald-950/40 text-emerald-400 border border-emerald-500/20"
              }`}>
                {isBreachedStatus ? "System Breach Detected" : "Steady State Protective active"}
              </span>

              {/* Authenticated user role identifier */}
              <span className={`text-[9px] font-mono tracking-normal uppercase px-1.5 py-0.5 rounded ml-1 border ${
                userRole === "admin"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-blue-500/10 text-blue-400 border-blue-500/20"
              }`}>
                {userRole === "admin" ? "🛡️ ADMIN LEVEL" : "🏛️ ORGANIZATION"}
              </span>
            </h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-tighter">
              Streaming Agent Anomaly Detection v1.0.4-stable
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Uptime</p>
            <p className="font-mono text-xs text-green-400 tracking-wider">
              {uptime}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">DB Status</p>
            <p className={`font-mono text-xs ${isConnected ? "text-blue-400" : "text-red-500 animate-pulse"}`}>
              {isConnected ? "CONNECTED" : "OFFLINE"}
            </p>
          </div>
          
          <button
            id="btn-simulate-surge"
            onClick={userRole === "admin" ? handleTriggerSpike : undefined}
            disabled={isSpikeTriggering || userRole !== "admin"}
            className={`rounded border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              userRole !== "admin"
                ? "border-white/10 bg-white/5 text-gray-650 cursor-not-allowed text-gray-500 opacity-60"
                : isSpikeTriggering 
                  ? "bg-red-600/20 border-red-500/50 text-red-300 cursor-not-allowed" 
                  : "border-red-500/30 bg-red-500/10 hover:bg-red-600 text-red-400 hover:text-white hover:border-red-500 active:scale-95"
            }`}
          >
            {userRole !== "admin" ? "🔒 Admin Only" : isSpikeTriggering ? "Injecting Attack..." : "💥 Simulate Burst"}
          </button>

          <button
            id="btn-logout"
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold uppercase hover:bg-white/10 text-gray-300 hover:text-white hover:border-white/20 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      {/* Workspace Flex Divider for Left Sidebar / Center Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar Configuration Drawer */}
        <aside id="panel-settings" className="w-64 flex flex-col border-r border-white/10 bg-[#080808] p-5 shrink-0 justify-between overflow-y-auto">
          <div className="space-y-6">
            <div className="border-b border-white/5 pb-2">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                Global Configuration {userRole !== "admin" ? <span className="text-red-500 font-mono text-[9px] block lowercase normal-case mt-0.5 font-normal tracking-wide">[READ ONLY: REQUIRES ADMIN LEVEL]</span> : null}
              </h2>
            </div>

            {/* Slider 1: Sliding Window */}
            <div className={userRole !== "admin" ? "opacity-50 select-none" : ""}>
              <div className="flex justify-between text-[10px] mb-2 uppercase text-gray-400">
                <span>Window Size</span>
                <span className="font-mono text-blue-400">{windowSize} seconds</span>
              </div>
              <input
                type="range"
                min="30"
                max="300"
                step="5"
                value={windowSize}
                disabled={userRole !== "admin"}
                onChange={(e) => handleUpdateSettings("window", parseInt(e.target.value))}
                className={`w-full h-1 bg-white/10 rounded-full appearance-none ${userRole === "admin" ? "accent-blue-500 cursor-pointer" : "accent-gray-650"}`}
              />
              <p className="text-[9px] text-gray-500 mt-1">Sliding calculation horizon.</p>
            </div>

            {/* Slider 2: Z-Score Threshold sensitivity */}
            <div className={userRole !== "admin" ? "opacity-50 select-none" : ""}>
              <div className="flex justify-between text-[10px] mb-2 uppercase text-gray-400">
                <span>Z-Score Sensitivity</span>
                <span className="font-mono text-red-500">{zScoreThresh.toFixed(2)} SD</span>
              </div>
              <input
                type="range"
                min="1.5"
                max="6.0"
                step="0.1"
                value={zScoreThresh}
                disabled={userRole !== "admin"}
                onChange={(e) => handleUpdateSettings("thresh", parseFloat(e.target.value))}
                className={`w-full h-1 bg-white/10 rounded-full appearance-none ${userRole === "admin" ? "accent-red-500 cursor-pointer" : "accent-gray-650"}`}
              />
              <p className="text-[9px] text-gray-500 mt-1">Breach trip standard deviation.</p>
            </div>

            {/* Slider 3: Stream pace interval */}
            <div className={userRole !== "admin" ? "opacity-50 select-none" : ""}>
              <div className="flex justify-between text-[10px] mb-2 uppercase text-gray-400">
                <span>Interval Rate</span>
                <span className="font-mono text-gray-300">{eventInterval} ms</span>
              </div>
              <input
                type="range"
                min="50"
                max="1000"
                step="50"
                value={eventInterval}
                disabled={userRole !== "admin"}
                onChange={(e) => handleUpdateSettings("interval", parseInt(e.target.value))}
                className={`w-full h-1 bg-white/10 rounded-full appearance-none ${userRole === "admin" ? "accent-slate-300 cursor-pointer" : "accent-gray-650"}`}
              />
              <p className="text-[9px] text-gray-500 mt-1">Normal pace generator ticking.</p>
            </div>

            {/* Selector: LLM Engine */}
            <div className={`space-y-2 pt-2 ${userRole !== "admin" ? "opacity-50 select-none" : ""}`}>
              <label className="text-[10px] uppercase text-gray-500">Autonomous Core LLM</label>
              <select 
                disabled={userRole !== "admin"}
                className="w-full bg-black border border-white/10 text-xs p-2 rounded focus:outline-none focus:border-red-500 text-gray-350"
              >
                <option value="gemini">Gemini-2.5-Flash (Active)</option>
                <option value="llama">Llama 3.2 (Local Host)</option>
              </select>
            </div>

            {/* Real-time MCP Status list */}
            <div className="p-3 bg-black border border-white/5 rounded space-y-1.5 font-mono text-[9px] leading-relaxed">
              <div className="text-gray-500 font-bold uppercase text-[9px] flex items-center gap-1">
                <Server className="w-3 h-3 text-red-500" /> MCP Authorized Tools
              </div>
              <ul className="text-gray-400 space-y-1 list-none">
                <li>• query_database(sql_query)</li>
                <li>• read_system_logs()</li>
                <li>• mitigate_anomaly(ip)</li>
                <li>• trigger_discord_alert(msg)</li>
              </ul>
            </div>
          </div>

          {/* Sidebar Footer Team details coordinates */}
          <div className="mt-8 border-t border-white/5 pt-4">
            <h3 className="text-[10px] font-bold uppercase mb-2 text-gray-650 tracking-wider">
              Team: Sigma Solutions
            </h3>
            <ul className="text-[10px] space-y-1 text-gray-400 font-mono">
              <li className="hover:text-red-400 transition-colors">[01] Alice Chen - 9.42 CGPA</li>
              <li className="hover:text-red-400 transition-colors">[02] Bob Miller - 8.85 CGPA</li>
              <li className="hover:text-red-400 transition-colors">[03] David Wang - 9.10 CGPA</li>
              <li className="hover:text-red-400 transition-colors">[04] Elena Rose - 8.95 CGPA</li>
            </ul>
          </div>
        </aside>

        {/* Top/Center Main Dashboard Feed area */}
        <main className="flex-1 flex flex-col p-6 overflow-y-auto bg-[#050505]">
          
          {/* Top telemetry grid parameters card */}
          <section className="grid grid-cols-4 gap-4 mb-6 shrink-0">
            {/* card 1 */}
            <div id="stat-card-opm" className="rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10">
              <p className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">Orders Per Minute (Velocity)</p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-3xl font-light text-white font-sans">{metrics.opm}</p>
                <span className={`text-[10px] font-mono ${isBreachedStatus ? "text-red-500 animate-pulse font-bold" : "text-green-500"}`}>
                  {isBreachedStatus ? "▲ CRITICAL" : "● STEADY"}
                </span>
              </div>
            </div>

            {/* card 2 */}
            <div id="stat-card-zscore" className={`rounded-lg border p-4 transition-all ${
              isBreachedStatus ? "border-red-500/30 bg-red-500/5 shadow-inner" : "border-white/5 bg-white/[0.02]"
            }`}>
              <p className={`text-[10px] uppercase font-medium tracking-wide ${isBreachedStatus ? "text-red-500" : "text-gray-500"}`}>
                Current Z-Score
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className={`text-3xl font-light font-sans ${isBreachedStatus ? "text-red-500" : "text-white"}`}>
                  {metrics.z_score.toFixed(2)}
                </p>
                <span className={`text-[10px] font-mono ${isBreachedStatus ? "text-red-400" : "text-gray-400"}`}>
                  {metrics.z_score > zScoreThresh ? "BREACHED" : "NORMAL"}
                </span>
              </div>
            </div>

            {/* card 3 */}
            <div id="stat-card-anoms" className="rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10">
              <p className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">Anomalies Detected</p>
              <div className="flex items-baseline gap-2 mt-1 text-white">
                <p className="text-3xl font-light font-sans">{anomalies.length}</p>
                <span className="text-[10px] text-gray-500 font-mono font-medium">TOTAL LISTED</span>
              </div>
            </div>

            {/* card 4 */}
            <div id="stat-card-threats" className="rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10">
              <p className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">Threat Mitigation State</p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className={`text-xl font-bold font-mono tracking-tight uppercase ${
                  isBreachedStatus 
                    ? "text-red-400" 
                    : metrics.status.includes("MITIGATING") 
                      ? "text-amber-400 animate-pulse" 
                      : "text-blue-400"
                }`}>
                  {metrics.status}
                </p>
              </div>
            </div>
          </section>

          {/* Analytics Area Chart & Step Reasoning Trace Dual Panel wrapper Grid */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[400px]">
            
            {/* Realtime database count graph */}
            <div id="wrapper-chart" className="lg:col-span-2 flex flex-col rounded-lg border border-white/10 bg-[#0d0d0d] p-4">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5 text-red-500" />
                  Real-Time Order Transaction Stream
                </h3>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-red-500 animate-pulse" : "bg-gray-700"}`}></span>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">Live telemetry feed</span>
                </div>
              </div>

              {/* Area chart using Recharts */}
              <div className="flex-1 w-full min-h-[250px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 15, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="glowRedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#151515" strokeDasharray="3 3" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#444444" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="#444444" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#080808",
                        borderColor: "#222222",
                        borderRadius: "4px",
                        fontSize: "11px",
                        color: "#eee"
                      }}
                      itemStyle={{ color: "#ef4444" }}
                      labelStyle={{ color: "#666" }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="count" 
                      name="Transactions/sec"
                      stroke="#ef4444" 
                      strokeWidth={1.5} 
                      fillOpacity={1} 
                      fill="url(#glowRedGrad)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>

                {isBreachedStatus && (
                  <div className="absolute left-[50%] top-[10%] border-l border-dashed border-red-500/50 h-[80%] pl-2 pointer-events-none">
                    <span className="text-[9px] bg-red-600 text-white px-1 uppercase tracking-widest font-mono font-bold animate-ping absolute">
                      ALERT SPIKE
                    </span>
                    <span className="text-[9px] bg-red-600 text-white px-1 uppercase tracking-widest font-mono font-bold relative">
                      ALERT SPIKE
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Monospace ReAct active logs or Org Governance panel */}
            <div id="wrapper-console" className="flex flex-col rounded-lg border border-white/10 bg-black font-mono text-[11px] h-full overflow-hidden">
              <div className="border-b border-white/10 bg-white/5 p-3 flex justify-between items-center shrink-0">
                <span className="text-blue-400 font-bold tracking-widest text-[10px] flex items-center gap-1.5">
                  {userRole === "admin" ? (
                    <>
                      <Terminal className="w-3.5 h-3.5 animate-pulse text-red-500" /> AGENT TRACE EXPLORER
                    </>
                  ) : (
                    <>
                      <Shield className="w-3.5 h-3.5 text-blue-400" /> ORG GOVERNANCE ASSURANCE
                    </>
                  )}
                </span>
                <span className="text-gray-500 text-[9px] uppercase tracking-wider">
                  {userRole === "admin" ? `Target: ${selectedAnomalyId ? `#${selectedAnomalyId}` : "None"}` : "COMPLIANCE LEVEL 2"}
                </span>
              </div>

              {/* Scrollable contents depending on role */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {userRole === "admin" ? (
                  /* Admin view: agent trace explorer */
                  selectedAnomalyId === null ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 space-y-2 py-8">
                      <Compass className="w-6 h-6 text-gray-700 animate-spin" />
                      <p className="text-[10px] uppercase font-mono tracking-widest">Console Engine Standby</p>
                      <p className="text-[9px] text-gray-600 max-w-[180px] leading-relaxed">
                        Select any anomaly event in historical log below to inspect step traces.
                      </p>
                    </div>
                  ) : traces.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 space-y-2 py-8">
                      <Activity className="w-6 h-6 text-red-500 animate-pulse" />
                      <p className="text-[10px] uppercase font-mono tracking-wider text-red-400">Agent Dispatched</p>
                      <p className="text-[9px] text-gray-600 max-w-[180px] leading-relaxed">
                        Compiling sliding statistical window records... Monitoring AI loop trace.
                      </p>
                    </div>
                  ) : (
                    traces.map((trace) => {
                      let badgeLabel = trace.type;
                      let colorClass = "text-gray-300";

                      if (trace.type === "Thought") {
                        colorClass = "text-yellow-500";
                      } else if (trace.type === "Action") {
                        colorClass = "text-blue-400 border-l border-blue-500/30 pl-2";
                      } else if (trace.type === "Observation") {
                        colorClass = "text-green-400 bg-green-950/20 px-1 py-0.5 rounded";
                      } else if (trace.type === "Final Response") {
                        colorClass = "text-red-400 font-bold border-t border-white/10 pt-1.5 mt-2";
                      }

                      return (
                        <div key={trace.id} className="space-y-1">
                          <div className="flex justify-between items-center text-[9px] text-gray-500">
                            <span>STEP {trace.step} // {badgeLabel}</span>
                            <span>{new Date(trace.timestamp * 1000).toLocaleTimeString()}</span>
                          </div>
                          <div className={`${colorClass} whitespace-pre-wrap leading-tight break-words font-mono block`}>
                            {trace.content}
                          </div>
                        </div>
                      );
                    })
                  )
                ) : (
                  /* Organization view: custom compliance assurance panel */
                  <div className="space-y-4 h-full flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="p-3 bg-blue-950/20 border border-blue-500/20 rounded-md">
                        <h4 className="text-[10px] uppercase font-bold text-blue-400 mb-1 flex items-center gap-1 font-sans">
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> Continuous Integration Ledger
                        </h4>
                        <p className="text-[10px] text-gray-400 leading-normal font-sans">
                          All streaming system logs and anomalies are verified and cryptographically committed in real-time to the SQLite audit DB.
                        </p>
                      </div>

                      <div className="space-y-2 text-[10px]">
                        <p className="text-gray-550 uppercase tracking-widest text-[9px] font-bold border-b border-white/5 pb-1 text-gray-500">
                          System Integrity Checklists
                        </p>
                        <div className="flex items-center justify-between text-gray-300 font-sans">
                          <span>• WAL Database Mode:</span>
                          <span className="text-green-400 font-mono font-bold">✓ VERIFIED</span>
                        </div>
                        <div className="flex items-center justify-between text-gray-300 font-sans">
                          <span>• Sliding Window Engine:</span>
                          <span className="text-green-400 font-mono font-bold">✓ ACTIVE ({windowSize}s)</span>
                        </div>
                        <div className="flex items-center justify-between text-gray-300 font-sans">
                          <span>• Standard Deviation Cutoff:</span>
                          <span className="text-green-400 font-mono font-bold">✓ EVALUATING ({zScoreThresh.toFixed(2)} SD)</span>
                        </div>
                        <div className="flex items-center justify-between text-gray-300 font-sans">
                          <span>• ReAct Agent Subroutine:</span>
                          <span className="text-blue-400 font-mono font-bold">✓ AUTHORIZED</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-white/5 space-y-2 shrink-0">
                      <button
                        onClick={() => setShowComplianceDetail(!showComplianceDetail)}
                        className="w-full bg-blue-600/10 hover:bg-blue-600 border border-blue-500/30 hover:border-blue-500 text-blue-400 hover:text-white rounded py-2 px-3 text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer font-sans"
                      >
                        {showComplianceDetail ? "Hide Verification Data" : "📋 Generate Compliance Report"}
                      </button>
                    </div>

                    {showComplianceDetail && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }} 
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 bg-[#080808] border border-white/10 rounded-md text-[9px] space-y-1.5 text-gray-400 font-mono"
                      >
                        <p className="font-bold uppercase text-white border-b border-white/5 pb-1 font-sans">Ledger Summary Report</p>
                        <p>Total Anomalies Recorded: <strong className="text-white">{anomalies.length}</strong></p>
                        <p>Latest Metric Velocity: <strong className="text-white">{metrics.opm} OPM</strong></p>
                        <p>Current Breach SD Cutoff: <strong className="text-white">{zScoreThresh.toFixed(2)}</strong></p>
                        <p className="text-[8px] text-gray-650 font-mono italic">
                          Hash: sha-256:{uptime.replace(/:/g, '')}f00d...
                        </p>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </section>

          {/* Historical anomaly grid dataset matrix */}
          <section id="panel-anomaly-feeds" className="mt-6 shrink-0">
            <h3 className="text-[10px] font-bold uppercase mb-3 text-gray-500 tracking-wider">
              Historical Anomaly Log (Database Collection)
            </h3>
            <div className="w-full overflow-hidden rounded-md border border-white/10 bg-[#0d0d0d]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-white/5 uppercase text-gray-500 font-mono text-[10px] border-b border-white/10">
                      <th className="p-3">Ref ID</th>
                      <th className="p-3">Trigger Time</th>
                      <th className="p-3">Breach Z-Score</th>
                      <th className="p-3">Event Count / Mean</th>
                      <th className="p-3">Mitigation Status</th>
                      <th className="p-3">Autonomous Action Taken / Diagnosis Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {anomalies.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500 text-[10px]">
                          NO SYSTEM ANOMALIES LOGGED IN DATABASE
                        </td>
                      </tr>
                    ) : (
                      anomalies.map((anom) => {
                        const isSelected = selectedAnomalyId === anom.id;
                        return (
                          <tr 
                            key={anom.id}
                            onClick={() => setSelectedAnomalyId(anom.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected 
                                ? "bg-white/10 text-white font-bold" 
                                : "hover:bg-white/[0.02] text-gray-400"
                            }`}
                          >
                            <td className="p-3 font-bold text-gray-300">
                              #{anom.id}
                            </td>
                            <td className="p-3">
                              {new Date(anom.timestamp * 1000).toLocaleTimeString()}
                            </td>
                            <td className="p-3 text-red-400 font-bold">
                              {anom.z_score.toFixed(2)}
                            </td>
                            <td className="p-3">
                              {anom.event_count}/s (μ: {anom.window_mean.toFixed(1)})
                            </td>
                            <td className="p-3">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                anom.status === "Mitigated" 
                                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30" 
                                  : "bg-red-950 text-red-500 border border-red-500/20"
                              }`}>
                                {anom.status}
                              </span>
                            </td>
                            <td className="p-3 italic text-gray-300 truncate max-w-xs">
                              {anom.diagnosis || "Processing..."}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

        </main>
      </div>

      {/* Footer System Status Bar */}
      <footer className="border-t border-white/10 bg-[#080808] px-6 py-2.5 flex justify-between items-center text-[10px] shrink-0">
        <div className="flex gap-4">
          <span className="text-gray-500 uppercase flex items-center gap-1">
            MCP Server: <span className="text-green-500 font-mono font-bold">Active</span>
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-gray-500 uppercase flex items-center gap-1">
            SQLite Schema: <span className="text-blue-400 font-mono font-bold">PRAGMA WAL_MODE</span>
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div>
          <span className="text-gray-300 font-mono text-[9px] uppercase tracking-wider">
            PRODUCER THREAD SAFE (STEADY TRANSACTION STEAM ACTIVE)
          </span>
        </div>
      </footer>

    </div>
  );
}
