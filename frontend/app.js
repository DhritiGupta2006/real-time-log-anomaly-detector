(() => {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const SEV = ["NORMAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const COLOR = ["var(--sev0)", "var(--sev1)", "var(--sev2)", "var(--sev3)", "var(--sev4)"];
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false });
  const EMPTY = { metrics: null, series: [], alerts: [], deliveries: [], aws: null };

  function reduce(s, m) {
    switch (m.type) {
      case "snapshot":
        return { metrics: m.metrics, series: m.series, alerts: m.alerts, deliveries: m.deliveries, aws: m.aws };
      case "metrics": {
        const d = m.data;
        const pt = { ts: d.ts, error_rate: d.error_rate, baseline_mean: d.baseline_mean, threshold_low: d.threshold_low, severity: d.severity };
        return { ...s, metrics: d, series: [...s.series.slice(-299), pt] };
      }
      case "alert": {
        const rest = s.alerts.filter((a) => a.id !== m.alert.id);
        return { ...s, alerts: [m.alert, ...rest].sort((a, b) => b.opened_at - a.opened_at).slice(0, 50) };
      }
      case "delivery":
        return { ...s, deliveries: [m.data, ...s.deliveries].slice(0, 60) };
      default:
        return s;
    }
  }

  // WebSocket with exponential-backoff reconnect; falls back to polling /api/state while disconnected.
  function useLive() {
    const [conn, setConn] = useState("connecting");
    const [state, setState] = useState(EMPTY);
    useEffect(() => {
      let ws, retry = 0, closed = false, poller = null, timer = null;
      const apply = (m) => setState((s) => reduce(s, m));
      const poll = async () => { try { apply(await (await fetch("/api/state")).json()); } catch (e) { /* offline */ } };
      const connect = () => {
        ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
        ws.onopen = () => { retry = 0; setConn("live"); clearInterval(poller); poller = null; };
        ws.onmessage = (e) => apply(JSON.parse(e.data));
        ws.onclose = () => {
          if (closed) return;
          setConn("reconnecting");
          if (!poller) { poll(); poller = setInterval(poll, 2000); }
          timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
        };
        ws.onerror = () => ws.close();
      };
      connect();
      return () => { closed = true; clearTimeout(timer); clearInterval(poller); ws && ws.close(); };
    }, []);
    return { conn, state };
  }

  function Chart({ series, metrics }) {
    const W = 900, H = 300, L = 44, R = 10, T = 10, B = 40;
    const pts = series.slice(-180);
    const maxV = Math.max(0.1, ...pts.map((p) => Math.max(p.error_rate, p.threshold_low || 0))) * 1.15;
    const x = (i) => L + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - Math.min(v, maxV) / maxV) * (H - T - B);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.error_rate).toFixed(1)}`).join(" ");
    const area = pts.length > 1 ? `${line} L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
    const last = pts[pts.length - 1];
    const stroke = COLOR[last ? last.severity : 0];
    const seg = pts.length > 1 ? (W - L - R) / (pts.length - 1) : 0;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxV);
    return h("svg", { className: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Error rate over time against baseline" },
      ticks.map((t) => h("g", { key: t }, h("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: "var(--line)" }),
        h("text", { className: "axis", x: L - 6, y: y(t) + 4, textAnchor: "end" }, pct(t, 0)))),
      area && h("path", { d: area, fill: stroke, opacity: 0.14 }),
      last && last.baseline_mean != null && h("line", { x1: L, x2: W - R, y1: y(last.baseline_mean), y2: y(last.baseline_mean), stroke: "var(--base)", strokeWidth: 1.5, strokeDasharray: "6 4" }),
      last && last.threshold_low != null && h("line", { x1: L, x2: W - R, y1: y(last.threshold_low), y2: y(last.threshold_low), stroke: "var(--sev1)", strokeWidth: 1, strokeDasharray: "2 4" }),
      h("path", { d: line, fill: "none", stroke, strokeWidth: 2.2, strokeLinejoin: "round" }),
      // severity strip: one cell per sample, coloured by the severity assigned at that tick
      pts.map((p, i) => h("rect", { key: i, x: x(i) - seg / 2, y: H - B + 12, width: seg + 0.5, height: 10, fill: COLOR[p.severity], opacity: p.severity ? 1 : 0.35 })),
      h("text", { className: "axis", x: L, y: H - 4 }, pts.length ? clock(pts[0].ts) : ""),
      h("text", { className: "axis", x: W - R, y: H - 4, textAnchor: "end" }, pts.length ? clock(last.ts) : ""),
      h("text", { className: "axis", x: W / 2, y: H - 4, textAnchor: "middle" }, "severity per tick"));
  }

  function Stat({ k, v, s, style }) {
    return h("div", { className: "stat" }, h("div", { className: "k" }, k), h("div", { className: "v num", style }, v), h("div", { className: "s", title: typeof s === "string" ? s : "" }, s));
  }

  function AlertCard({ a, deliveries }) {
    const sev = a.status === "ACTIVE" ? a.severity : a.peak_severity;
    const mine = deliveries.filter((d) => d.alert_id === a.id);
    const label = { sns: "SNS", cloudwatch: "CloudWatch" };
    return h("div", { className: "alert", style: { "--c": COLOR[sev] } },
      h("div", { className: "row" }, h("span", { className: "sev" }, SEV[a.status === "ACTIVE" ? a.severity : a.peak_severity]),
        h("span", { className: "num" }, `#${a.id}`), h("span", { className: "st" }, a.status === "ACTIVE" ? "Active" : "Resolved")),
      h("div", { className: "msg" }, a.message),
      h("div", { className: "meta num" }, `opened ${clock(a.opened_at)}` + (a.resolved_at ? ` · resolved ${clock(a.resolved_at)}` : "") + ` · peak ${pct(a.peak_error_rate)} (${SEV[a.peak_severity]})`),
      mine.length > 0 && h("div", { className: "chips" }, mine.slice(0, 6).map((d, i) =>
        h("span", { key: i, className: `chip ${d.status}`, title: d.detail }, `${label[d.target]} ${d.event}: ${d.status}`))));
  }

  function App() {
    const { conn, state } = useLive();
    const { metrics: m, series, alerts, deliveries, aws } = state;
    const [sim, setSim] = useState("normal");
    useEffect(() => { fetch("/api/simulator").then((r) => r.json()).then((j) => setSim(j.mode)).catch(() => {}); }, []);
    const setMode = async (mode) => {
      try { const j = await (await fetch("/api/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) })).json(); setSim(j.mode); } catch (e) { /* ignore */ }
    };
    const sev = m ? m.severity : 0;
    const active = useMemo(() => alerts.filter((a) => a.status === "ACTIVE").length, [alerts]);
    const pipeline = !m ? "Waiting for data" : m.status === "warming_up" ? "Learning baseline" : m.status === "insufficient_data" ? "Low traffic" : m.status === "anomaly" ? "Anomaly detected" : "Healthy";
    const awsLabel = !aws ? "n/a" : !aws.enabled ? "AWS off (dry run)" : Object.values(aws.targets).some((t) => t.circuit_open) ? "AWS degraded" : "AWS connected";

    return h("div", { className: "app" },
      h("div", { className: "top" },
        h("div", { className: "brand" }, h("svg", { viewBox: "0 0 32 32" }, h("path", { d: "M2 17h7l3-9 5 17 3-8h10", fill: "none", stroke: "var(--accent)", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" })), "LogPulse"),
        h("span", { className: "spacer" }),
        h("span", { className: "pill", title: "Dashboard connection" }, h("span", { className: `dot ${conn === "live" ? "live" : "bad"}` }), conn === "live" ? "WebSocket live" : conn === "connecting" ? "Connecting…" : "Reconnecting · polling"),
        h("span", { className: "pill" }, h("span", { className: `dot ${aws && aws.enabled ? "live" : ""}` }), awsLabel)),
      m && m.status === "warming_up" && h("div", { className: "banner" }, `Learning normal behaviour: ${m.baseline_samples}/${m.baseline_required} baseline samples. Alerts start once the baseline is ready.`),
      h("div", { className: "strip" },
        h(Stat, { k: "Current error rate", v: m ? pct(m.error_rate) : "–", s: m ? `${m.window_errors} errors / ${m.window_events} events in window` : "", style: { color: COLOR[sev] } }),
        h(Stat, { k: "Baseline", v: m && m.baseline_samples ? pct(m.baseline_mean) : "–", s: m ? `σ ${pct(m.baseline_std, 2)} · low alert above ${pct(m.threshold_low)}` : "" }),
        h(Stat, { k: "Severity", v: h("span", { className: "badge", style: { background: sev ? COLOR[sev] : "transparent", color: sev ? "#101828" : COLOR[0], padding: sev ? "2px 10px" : 0 } }, SEV[sev]), s: m ? `${m.z_score.toFixed(1)}σ from baseline` : "" }),
        h(Stat, { k: "Events processed", v: m ? m.events_processed.toLocaleString() : "–", s: m ? `${m.malformed_lines} malformed lines skipped` : "" }),
        h(Stat, { k: "System status", v: h("span", { style: { fontSize: 20, fontFamily: "var(--sans)" } }, pipeline), s: `${active} active alert${active === 1 ? "" : "s"}` })),
      h("div", { className: "main" },
        h("div", { className: "card" },
          h("div", { className: "chart-head" },
            h("div", null, h("h2", null, "Error rate"), h("div", { className: "sub" }, "Rolling window vs. learned baseline")),
            h("div", { className: "controls" },
              h("button", { className: `btn danger ${sim === "spike" ? "on" : ""}`, onClick: () => setMode("spike"), disabled: sim === "spike" }, "Inject error spike"),
              h("button", { className: "btn", onClick: () => setMode("normal"), disabled: sim === "normal" }, "Stop spike"))),
          h("div", { className: "legend" },
            h("span", null, h("i", { style: { borderColor: "var(--accent)" } }), "Error rate"),
            h("span", null, h("i", { style: { borderColor: "var(--base)", borderTopStyle: "dashed" } }), "Baseline"),
            h("span", null, h("i", { style: { borderColor: "var(--sev1)", borderTopStyle: "dotted" } }), "Low threshold (+1σ)")),
          h(Chart, { series, metrics: m })),
        h("div", { className: "card" },
          h("h2", null, "Live alert feed"),
          h("div", { className: "sub" }, "Newest incident first. Updates as they happen."),
          h("div", { className: "feed" }, alerts.length === 0
            ? h("div", { className: "empty" }, "No alerts. Use “Inject error spike” to trigger one.")
            : alerts.map((a) => h(AlertCard, { key: `${a.id}:${a.severity}:${a.status}`, a, deliveries }))))));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
