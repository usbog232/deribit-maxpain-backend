import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { RefreshCw, Gauge, TrendingUp, CircleDollarSign } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function pretty(n, d = 0) {
  if (n == null || Number.isNaN(n)) return "-";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return Number(n).toFixed(d);
}

function Card({ title, value, icon: Icon }) {
  return (
    <div className="card">
      <div>
        <div className="card-title">{title}</div>
        <div className="card-value">{value}</div>
      </div>
      {Icon ? <Icon size={22} /> : null}
    </div>
  );
}

export default function Dashboard() {
  const [currency, setCurrency] = useState("BTC");
  const [expiries, setExpiries] = useState([]);
  const [expiry, setExpiry] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 拉取到期日
  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const j = await fetchJSON(`${API_BASE}/api/expiries?currency=${currency}`);
        setExpiries(j.expiries || []);
        setExpiry(j.expiries?.[0] || "");
      } catch (e) {
        setErr("获取到期日失败：" + e.message);
      }
    })();
  }, [currency]);

  // 拉取 OI
  async function loadOI() {
    if (!expiry) return;
    try {
      setLoading(true);
      setErr("");
      const j = await fetchJSON(`${API_BASE}/api/oi?currency=${currency}&expiry=${expiry}`);
      setData(j);
    } catch (e) {
      setErr("拉取数据失败：" + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadOI(); }, [expiry]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadOI, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, currency, expiry]);

  // 图表数据（把 strike 转成字符串，方便 ReferenceLine 匹配）
  const chartData = useMemo(() => {
    if (!data) return [];
    return (data.strikes || []).map((k) => ({
      strike: String(k),
      Calls: data.call_by_strike?.[k] || 0,
      Puts: data.put_by_strike?.[k] || 0,
    }));
  }, [data]);

  return (
    <div className="wrap">
      <header className="header">
        <div className="title">期权 Max Pain 实时看板</div>
        <span className="badge">Deribit</span>
      </header>

      {/* 控件区 */}
      <div className="toolbar">
        <div className="btn-group">
          {["BTC", "ETH"].map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={"btn " + (currency === c ? "btn-primary" : "")}
            >
              {c}
            </button>
          ))}
        </div>

        <select className="select" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
          {expiries.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <div className="right">
          <label className="checkbox">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span>自动刷新(30s)</span>
          </label>
          <button className="btn" onClick={loadOI}><RefreshCw size={18} style={{marginRight:6}}/>刷新</button>
        </div>
      </div>

      {/* 指标卡片 */}
      <div className="grid">
        <Card title="Call OI" value={pretty(data?.call_open_interest)} icon={TrendingUp} />
        <Card title="Put OI" value={pretty(data?.put_open_interest)} icon={TrendingUp} />
        <Card title="C/P Ratio" value={data ? (data.call_put_ratio).toFixed(2) : "-"} icon={Gauge} />
        <Card title="Notional(估)" value={"$ " + pretty(data?.notional_value_est)} icon={CircleDollarSign} />
      </div>

      {/* 柱状图 */}
      <div className="panel">
        <div className="panel-head">
          <div>按行权价分布（未平仓量）</div>
          <div className="muted">Max Pain: {data?.max_pain_price ?? "-"}</div>
        </div>
        <div style={{height: 420}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 12, right: 12, top: 10, bottom: 10 }}>
              <XAxis dataKey="strike" stroke="#8a97a7" />
              <YAxis stroke="#8a97a7" />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10 }}
                      labelStyle={{ color: "#e2e8f0" }}
                      cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Legend />
              {data?.max_pain_price && (
                <ReferenceLine x={String(data.max_pain_price)} stroke="#60a5fa" strokeDasharray="3 3"
                  label={{ value: "Max Pain", fill: "#93c5fd", position: "insideTop" }} />
              )}
              <Bar dataKey="Calls" fill="#60a5fa" />
              <Bar dataKey="Puts" fill="#fca5a5" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {loading ? <div className="muted" style={{marginTop:8}}>加载中…</div> : null}
      {err ? <div className="error">{err}</div> : null}

      <footer className="foot">数据源：Deribit Public API · 本页面仅供研究与教育用途，非投资建议。</footer>
    </div>
  );
}

