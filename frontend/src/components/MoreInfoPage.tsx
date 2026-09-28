import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  Layers,
  Cpu,
  BellRing,
  GitCommit,
  CheckCircle2,
  Info,
  ExternalLink,
  ShieldAlert,
  Clock,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'

interface MoreInfoPageProps {
  onNavigateToIntro: () => void
  onNavigateToDashboard: () => void
}

export function MoreInfoPage({
  onNavigateToIntro,
  onNavigateToDashboard,
}: MoreInfoPageProps) {
  const [activeTab, setActiveTab] = useState<'architecture' | 'statistics' | 'state_machine' | 'health'>('architecture')

  // Interactive formula state for demo
  const [simRate, setSimRate] = useState(0.24)
  const [simBase, setSimBase] = useState(0.02)
  const [simNShort, setSimNShort] = useState(500)
  const [simNBase, setSimNBase] = useState(15000)

  // Two-proportion pooled z-score computation
  const x1 = simRate * simNShort
  const x2 = simBase * simNBase
  const pPooled = (x1 + x2) / (simNShort + simNBase)
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / simNShort + 1 / simNBase))
  const calculatedZ = se > 0 ? (simRate - simBase) / se : 0
  const deltaPp = (simRate - simBase) * 100
  const effectSizeMultiple = simBase > 0 ? (simRate / simBase).toFixed(1) : '∞'
  const isAnomaly = calculatedZ >= 3.0 && deltaPp >= 2.0

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans antialiased selection:bg-[#262626] selection:text-white">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#262626] bg-[#0a0a0a]/90 backdrop-blur-md px-6 py-3.5">
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateToIntro}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#111111] px-3 py-1.5 text-xs text-[#8a8a8a] transition-colors hover:border-[#5c5c5c] hover:text-[#ededed] cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Intro</span>
          </button>
          <div className="h-4 w-[1px] bg-[#262626]" />
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#ededed]" />
            <span className="text-sm font-semibold tracking-tight text-[#ededed]">
              System Architecture &amp; Theory
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/static/index.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#111111] px-3 py-1.5 text-xs font-mono text-[#8a8a8a] transition-colors hover:border-[#5c5c5c] hover:text-[#ededed]"
          >
            <span>Single-File HTML</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={onNavigateToDashboard}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#ededed] px-4 py-1.5 text-xs font-semibold text-[#0a0a0a] transition-colors hover:bg-[#ffffff] cursor-pointer"
          >
            <span>Open Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1200px] px-6 py-12 flex flex-col gap-12">
        {/* Hero Section */}
        <section className="flex flex-col gap-4 max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-[#8a8a8a]">
            <span>ENGINEERING SPECIFICATION</span>
            <span aria-hidden="true">·</span>
            <span>PRODUCTION OBSERVABILITY</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#ededed] text-balance">
            Real-Time Statistical Log Anomaly Detection
          </h1>
          <p className="text-base text-[#8a8a8a] leading-relaxed">
            Standard static error rate alerts fail in modern production services: rigid thresholds either flap during organic traffic surges or miss slow-boiling systemic regressions. This detector applies continuous exponential weighted baselining and rigorous two-proportion z-tests to distinguish genuine incidents from stochastic background noise.
          </p>
        </section>

        {/* Section Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-[#262626] pb-2 overflow-x-auto">
          {[
            { id: 'architecture', label: '1. Pipeline Architecture', icon: Layers },
            { id: 'statistics', label: '2. Statistical Hypothesis & Z-Score', icon: Cpu },
            { id: 'state_machine', label: '3. Incident Lifecycle & Escalation', icon: GitCommit },
            { id: 'health', label: '4. Pipeline Health & Freshness', icon: ShieldAlert },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-[8px] transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#171717] text-[#ededed] border border-[#262626]'
                    : 'text-[#8a8a8a] hover:text-[#ededed]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab 1: Pipeline Architecture */}
        {activeTab === 'architecture' && (
          <section className="flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-3 rounded-[8px] border border-[#262626] bg-[#111111] p-5">
                <div className="flex items-center justify-between text-xs text-[#8a8a8a] font-mono">
                  <span>STAGE 01</span>
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-base font-semibold text-[#ededed]">Sub-Second Log Tailer</h3>
                <p className="text-xs text-[#8a8a8a] leading-relaxed">
                  Continuously streams lines from <code className="text-[#ededed] font-mono">application.log</code> using an in-memory byte offset cursor. Parses structured JSON and standard logfmt formatting without process restarts or I/O blocking.
                </p>
                <div className="mt-auto pt-3 border-t border-[#262626] flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
                  <span>Target Throughput</span>
                  <span className="text-[#ededed]">5,000+ lines/s</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-[8px] border border-[#262626] bg-[#111111] p-5">
                <div className="flex items-center justify-between text-xs text-[#8a8a8a] font-mono">
                  <span>STAGE 02</span>
                  <Cpu className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-base font-semibold text-[#ededed]">Dual-Window Aggregator</h3>
                <p className="text-xs text-[#8a8a8a] leading-relaxed">
                  Maintains a short rolling window (typically 10–30 seconds) to capture immediate shocks, alongside a learned baseline window (typically 300 seconds to 24 hours) with continuous EWMA variance tracking.
                </p>
                <div className="mt-auto pt-3 border-t border-[#262626] flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
                  <span>Sampling Cadence</span>
                  <span className="text-[#ededed]">1.0 Hz tick tick</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-[8px] border border-[#262626] bg-[#111111] p-5">
                <div className="flex items-center justify-between text-xs text-[#8a8a8a] font-mono">
                  <span>STAGE 03</span>
                  <BellRing className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-base font-semibold text-[#ededed]">Dispatcher &amp; Telemetry</h3>
                <p className="text-xs text-[#8a8a8a] leading-relaxed">
                  Broadcasts JSON snapshots and incremental state delta events to dashboard clients over WebSockets. Synchronously flushes critical alert events to AWS CloudWatch Logs and SNS topics for paging.
                </p>
                <div className="mt-auto pt-3 border-t border-[#262626] flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
                  <span>Client Transport</span>
                  <span className="text-[#ededed]">WebSocket / WSS</span>
                </div>
              </div>
            </div>

            {/* Architecture Flow Diagram */}
            <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-6 flex flex-col gap-4">
              <div className="text-xs font-mono uppercase text-[#8a8a8a]">
                DATA FLOW &amp; EXECUTION TOPOLOGY
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center py-4">
                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-center">
                  <div className="text-[10px] font-mono text-[#8a8a8a]">INPUT</div>
                  <div className="text-xs font-semibold text-[#ededed] mt-1">application.log</div>
                  <div className="text-[10px] text-[#8a8a8a] mt-0.5">Raw log stream</div>
                </div>
                <div className="text-center text-[#5c5c5c] font-mono text-sm hidden sm:block">──▶</div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-center">
                  <div className="text-[10px] font-mono text-[#8a8a8a]">INGESTION</div>
                  <div className="text-xs font-semibold text-[#ededed] mt-1">Tailer &amp; Parser</div>
                  <div className="text-[10px] text-[#8a8a8a] mt-0.5">Line classification</div>
                </div>
                <div className="text-center text-[#5c5c5c] font-mono text-sm hidden sm:block">──▶</div>

                <div className="rounded-[8px] border border-[#ededed] bg-[#171717] p-3 text-center">
                  <div className="text-[10px] font-mono text-[#8a8a8a]">ENGINE</div>
                  <div className="text-xs font-semibold text-[#ededed] mt-1">Z-Score Evaluator</div>
                  <div className="text-[10px] text-emerald-400 mt-0.5">z ≥ 3.0 &amp; Δ ≥ 2 pp</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2 pt-4 border-t border-[#262626] text-xs text-[#8a8a8a]">
                <div className="flex flex-col gap-1">
                  <strong className="text-[#ededed] font-medium">Why dual windows?</strong>
                  <span>A short window reacts within seconds when an outage starts, while the baseline window ensures transient spikes do not corrupt historical normal expectations.</span>
                </div>
                <div className="flex flex-col gap-1">
                  <strong className="text-[#ededed] font-medium">Zero false-alarm warm-up</strong>
                  <span>The system enforces a 60-second learning phase upon start to collect baseline volume before enabling alert evaluation.</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 2: Statistical Hypothesis & Z-Score */}
        {activeTab === 'statistics' && (
          <section className="flex flex-col gap-8">
            <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-[#8a8a8a]">
                  MATHEMATICAL DERIVATION
                </span>
                <span className="rounded-[4px] border border-[#262626] bg-[#0a0a0a] px-2 py-0.5 text-[10px] font-mono text-[#8a8a8a]">
                  Two-Proportion Z-Test
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold text-[#ededed]">The Z-Score Test Formulation</h3>
                <p className="text-xs text-[#8a8a8a] leading-relaxed">
                  Let <span className="font-mono text-[#ededed]">r</span> be the short-window error proportion over <span className="font-mono text-[#ededed]">n₁</span> requests, and <span className="font-mono text-[#ededed]">p₀</span> be the learned baseline error proportion over <span className="font-mono text-[#ededed]">n₂</span> historical samples. Under the null hypothesis <span className="font-mono text-[#ededed]">H₀: r = p₀</span>, the test statistic is:
                </p>

                {/* Mathematical Equation display */}
                <div className="my-2 rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 text-center font-mono text-sm sm:text-base text-[#ededed] overflow-x-auto">
                  z = (r - p₀) / √[ p̂ (1 - p̂) · (1/n₁ + 1/n₂) ]
                </div>

                <p className="text-xs text-[#8a8a8a] leading-relaxed">
                  where <span className="font-mono text-[#ededed]">p̂ = (x₁ + x₂) / (n₁ + n₂)</span> is the pooled error probability. An alert fires only when both of the following invariants hold:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                  <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs flex flex-col gap-1">
                    <span className="font-mono font-semibold text-emerald-400">1. Statistical Significance</span>
                    <span className="text-[#ededed] font-mono text-sm">z ≥ 3.0</span>
                    <span className="text-[#8a8a8a] text-[11px]">Corresponds to a 99.87% one-sided confidence level. Less than 0.13% chance of occurring by random chance.</span>
                  </div>
                  <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs flex flex-col gap-1">
                    <span className="font-mono font-semibold text-emerald-400">2. Practical Effect Size</span>
                    <span className="text-[#ededed] font-mono text-sm">Δ ≥ +2.0 pp</span>
                    <span className="text-[#8a8a8a] text-[11px]">Prevents high-volume low-drift alerts (e.g., 2.01% vs 2.00% across 1,000,000 requests) from waking engineers.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Calculator */}
            <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-6 flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#ededed]">Interactive Z-Score Evaluator</h3>
                  <p className="text-xs text-[#8a8a8a]">Adjust parameters below to see how the mathematical detector responds in real time.</p>
                </div>
                <div className={`px-3 py-1 rounded-[8px] font-mono text-xs font-medium border ${
                  isAnomaly
                    ? 'bg-rose-950/40 text-rose-300 border-rose-800'
                    : 'bg-emerald-950/40 text-emerald-300 border-emerald-800'
                }`}>
                  {isAnomaly ? '▲ ANOMALY TRIGGERED' : '● WITHIN BASELINE'}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#8a8a8a]">Current Error Rate (r):</span>
                      <span className="text-[#ededed] font-semibold">{(simRate * 100).toFixed(1)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.005"
                      max="0.5"
                      step="0.005"
                      value={simRate}
                      onChange={(e) => setSimRate(parseFloat(e.target.value))}
                      className="accent-[#ededed] cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#8a8a8a]">Baseline Error Rate (p₀):</span>
                      <span className="text-[#ededed] font-semibold">{(simBase * 100).toFixed(1)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.005"
                      max="0.10"
                      step="0.005"
                      value={simBase}
                      onChange={(e) => setSimBase(parseFloat(e.target.value))}
                      className="accent-[#ededed] cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#8a8a8a]">Short Window Sample (n₁):</span>
                      <span className="text-[#ededed] font-semibold">{simNShort} lines</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={simNShort}
                      onChange={(e) => setSimNShort(parseInt(e.target.value))}
                      className="accent-[#ededed] cursor-pointer"
                    />
                  </div>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 flex flex-col justify-between">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <div className="text-[10px] uppercase font-mono text-[#8a8a8a]">Computed Z-Score</div>
                      <div className="text-2xl font-mono font-semibold text-[#ededed] mt-1">
                        z = {calculatedZ.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-[#8a8a8a] mt-0.5">Threshold: 3.00</div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-mono text-[#8a8a8a]">Effect Size (Δ)</div>
                      <div className="text-2xl font-mono font-semibold text-[#ededed] mt-1">
                        +{deltaPp.toFixed(1)} pp
                      </div>
                      <div className="text-[10px] text-[#8a8a8a] mt-0.5">{effectSizeMultiple}× baseline</div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#262626] text-[11px] text-[#8a8a8a]">
                    {isAnomaly
                      ? 'Both statistical threshold (z ≥ 3.0) and practical minimum delta (≥ +2.0 pp) satisfied. Incident is opened.'
                      : calculatedZ >= 3.0
                      ? 'Statistical significance reached, but delta is under +2.0 pp. Alert suppressed to prevent noise.'
                      : 'Fluctuation is within normal statistical confidence interval.'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: State Machine & Escalation */}
        {activeTab === 'state_machine' && (
          <section className="flex flex-col gap-6">
            <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-6 flex flex-col gap-4">
              <h3 className="text-base font-semibold text-[#ededed]">Incident State Machine</h3>
              <p className="text-xs text-[#8a8a8a] leading-relaxed">
                Incidents follow a deterministic transition lifecycle to prevent flapping and duplicate alerts while ensuring timely escalation.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 py-2">
                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] text-[#8a8a8a]">STATE 01</span>
                  <span className="font-semibold text-sm text-[#ededed]">WARMING UP</span>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">Accumulates 60s of normal traffic to estimate μ and σ. No alerts emitted.</p>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] text-[#8a8a8a]">STATE 02</span>
                  <span className="font-semibold text-sm text-emerald-400">NORMAL / HEALTHY</span>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">Detector active. Error rate within baseline variation range.</p>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] text-[#8a8a8a]">STATE 03</span>
                  <span className="font-semibold text-sm text-amber-400">OPEN / ESCALATED</span>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">z ≥ 3.0 confirmed. Escalates LOW → MEDIUM → HIGH → CRITICAL if rate worsens.</p>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-4 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] text-[#8a8a8a]">STATE 04</span>
                  <span className="font-semibold text-sm text-[#8a8a8a]">RESOLVED</span>
                  <p className="text-[11px] text-[#8a8a8a] mt-1">Error rate stays below z &lt; 1.5 for cooldown period. Incident closes automatically.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-5 flex flex-col gap-2 text-xs">
                <h4 className="font-semibold text-[#ededed]">Severity Tier Matrix</h4>
                <div className="flex flex-col gap-2 mt-2 font-mono text-[11px]">
                  <div className="flex items-center justify-between border-b border-[#262626] pb-1.5">
                    <span className="text-[#ededed]">CRITICAL</span>
                    <span className="text-[#8a8a8a]">Rate &gt; 40% OR z &gt; 8.0</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#262626] pb-1.5">
                    <span className="text-[#ededed]">HIGH</span>
                    <span className="text-[#8a8a8a]">Rate &gt; 20% OR z &gt; 5.0</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#262626] pb-1.5">
                    <span className="text-[#ededed]">MEDIUM</span>
                    <span className="text-[#8a8a8a]">Rate &gt; 10% OR z &gt; 3.5</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#ededed]">LOW</span>
                    <span className="text-[#8a8a8a]">Baseline deviation (z ≥ 3.0)</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-5 flex flex-col gap-2 text-xs">
                <h4 className="font-semibold text-[#ededed]">Hysteresis &amp; Cooldown</h4>
                <p className="text-[#8a8a8a] leading-relaxed mt-1">
                  To prevent flapping between states at border thresholds:
                </p>
                <ul className="list-disc pl-4 text-[#8a8a8a] space-y-1">
                  <li><strong>Opening threshold:</strong> <code className="text-[#ededed]">z ≥ 3.0</code> for 2 consecutive ticks.</li>
                  <li><strong>Resolution threshold:</strong> <code className="text-[#ededed]">z &lt; 1.5</code> sustained for 10 seconds.</li>
                  <li><strong>In-place updates:</strong> Escalations mutate the existing incident object rather than generating duplicate alerts.</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Pipeline Health & Freshness */}
        {activeTab === 'health' && (
          <section className="flex flex-col gap-6">
            <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-6 flex flex-col gap-4">
              <h3 className="text-base font-semibold text-[#ededed]">Pipeline Health &amp; Data Freshness Model</h3>
              <p className="text-xs text-[#8a8a8a] leading-relaxed">
                In operational monitoring, data freshness is as important as the metric value itself. If the detector stops tailing or log delivery lags, values are explicitly tagged rather than masked with dashes or stale assumptions.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs">
                  <div className="text-[10px] font-mono text-emerald-400">FRESH</div>
                  <div className="font-semibold text-[#ededed] mt-1">≤ 3.0 seconds</div>
                  <div className="text-[11px] text-[#8a8a8a] mt-0.5">Live streaming mode</div>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs">
                  <div className="text-[10px] font-mono text-amber-400">DELAYED</div>
                  <div className="font-semibold text-[#ededed] mt-1">4.0 – 10.0 seconds</div>
                  <div className="text-[11px] text-[#8a8a8a] mt-0.5">Tailer lag warning</div>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs">
                  <div className="text-[10px] font-mono text-rose-400">STALE</div>
                  <div className="font-semibold text-[#ededed] mt-1">&gt; 10.0 seconds</div>
                  <div className="text-[11px] text-[#8a8a8a] mt-0.5">Dimmed data presentation</div>
                </div>

                <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs">
                  <div className="text-[10px] font-mono text-[#8a8a8a]">OFFLINE</div>
                  <div className="font-semibold text-[#ededed] mt-1">Disconnected</div>
                  <div className="text-[11px] text-[#8a8a8a] mt-0.5">Preserves last known values</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-4 text-xs flex flex-col gap-1">
                <span className="font-mono text-[10px] text-[#8a8a8a]">METRIC</span>
                <span className="font-semibold text-[#ededed]">Tailer Lag</span>
                <p className="text-[#8a8a8a] text-[11px]">Time delta between the timestamp on the log line and the current wall clock time.</p>
              </div>

              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-4 text-xs flex flex-col gap-1">
                <span className="font-mono text-[10px] text-[#8a8a8a]">METRIC</span>
                <span className="font-semibold text-[#ededed]">Bad Line Ratio</span>
                <p className="text-[#8a8a8a] text-[11px]">Fraction of incoming log entries that fail schema parsing or regex classification.</p>
              </div>

              <div className="rounded-[8px] border border-[#262626] bg-[#111111] p-4 text-xs flex flex-col gap-1">
                <span className="font-mono text-[10px] text-[#8a8a8a]">METRIC</span>
                <span className="font-semibold text-[#ededed]">Queue Depth</span>
                <p className="text-[#8a8a8a] text-[11px]">Number of raw log events queued in the ring buffer awaiting aggregation.</p>
              </div>
            </div>
          </section>
        )}

        {/* Bottom CTA Section */}
        <section className="mt-8 rounded-[8px] border border-[#262626] bg-[#111111] p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xl font-semibold text-[#ededed]">Ready to monitor live telemetry?</h3>
            <p className="text-xs text-[#8a8a8a]">
              Switch to the real-time operational dashboard with integrated simulator scenarios.
            </p>
          </div>
          <button
            onClick={onNavigateToDashboard}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#ededed] px-5 py-2.5 text-xs font-semibold text-[#0a0a0a] transition-colors hover:bg-[#ffffff] cursor-pointer whitespace-nowrap"
          >
            <span>Launch Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </section>
      </main>
    </div>
  )
}
