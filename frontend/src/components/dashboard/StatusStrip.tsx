import { Tick, Alert, SystemStatus, DetectorStateType } from '@/types/dashboard'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Layers,
} from 'lucide-react'

interface StatusStripProps {
  currentTick?: Tick
  ticks?: Tick[]
  activeIncident: Alert | null
  systemStatus: SystemStatus
  detectorState: DetectorStateType
  dataAgeSec: number
  isStale?: boolean
}

// Simple helper to draw an inline SVG sparkline
function Sparkline({
  data,
  color = '#a3a3a3',
  baseline,
}: {
  data: number[]
  color?: string
  baseline?: number
}) {
  if (data.length < 2) {
    return <div className="h-6 w-full opacity-20 bg-[#262626] rounded-[4px]" />
  }

  const min = Math.min(0, ...data)
  const max = Math.max(0.01, ...data)
  const range = max - min || 1
  const width = 120
  const height = 24

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-6 w-full max-w-[130px] overflow-visible"
      preserveAspectRatio="none"
    >
      {baseline !== undefined && (
        <line
          x1="0"
          y1={height - ((baseline - min) / range) * (height - 4) - 2}
          x2={width}
          y2={height - ((baseline - min) / range) * (height - 4) - 2}
          stroke="#525252"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
    </svg>
  )
}

export function StatusStrip({
  currentTick,
  ticks = [],
  activeIncident,
  systemStatus,
  detectorState,
  dataAgeSec,
  isStale,
}: StatusStripProps) {
  const isWarmingUp = detectorState === 'warming_up' || systemStatus === 'WARMING_UP' || !currentTick
  const warmupSec = currentTick?.warmup_s ?? 0
  const maxWarmupSec = 60

  // Error rate & effect size metrics
  const currentRate = currentTick ? currentTick.rate : 0.02
  const baselineRate = currentTick ? currentTick.baseline : 0.02
  const currentRateStr = currentTick ? `${(currentRate * 100).toFixed(1)}%` : '—'
  const baselineRateStr = currentTick ? `${(baselineRate * 100).toFixed(1)}%` : '—'

  const deltaPp = (currentRate - baselineRate) * 100
  const deltaSign = deltaPp >= 0 ? '+' : ''
  const deltaStr = `${deltaSign}${deltaPp.toFixed(1)} pp`
  const multipleOfBaseline = baselineRate > 0 ? (currentRate / baselineRate).toFixed(2) : '1.00'

  // Volume metrics
  const currentVol = currentTick ? currentTick.volume : 498
  const baselineVol = 502
  const volPctOfExpected = ((currentVol / baselineVol) * 100).toFixed(1)
  const volDeltaPct = (((currentVol - baselineVol) / baselineVol) * 100).toFixed(1)
  const volDeltaSign = Number(volDeltaPct) >= 0 ? '+' : ''

  // Detection z-score
  const zScore = currentTick?.z !== undefined ? currentTick.z : 0.6
  const zScoreStr = currentTick ? `z = ${zScore.toFixed(2)}` : '—'
  const isZAnomaly = zScore >= 3.0

  // Sparkline data extraction
  const rateHistory = ticks.map((t) => t.rate || 0)
  const volHistory = ticks.map((t) => t.volume || 0)
  const zHistory = ticks.map((t) => t.z || 0)

  // Status label & color
  let statusText = 'HEALTHY'
  let statusColor = 'text-emerald-400'
  let statusDotColor = 'bg-emerald-400'

  if (detectorState === 'warming_up') {
    statusText = 'WARMING UP'
    statusColor = 'text-cyan-400'
    statusDotColor = 'bg-cyan-400 motion-safe:animate-pulse'
  } else if (detectorState === 'incident_open') {
    statusText = activeIncident?.severity ? `${activeIncident.severity} ANOMALY` : 'ANOMALY'
    statusColor = activeIncident?.severity === 'CRITICAL' ? 'text-rose-400' : 'text-orange-400'
    statusDotColor = activeIncident?.severity === 'CRITICAL' ? 'bg-rose-500 motion-safe:animate-pulse' : 'bg-orange-400'
  } else if (detectorState === 'degraded') {
    statusText = 'DEGRADED'
    statusColor = 'text-amber-400'
    statusDotColor = 'bg-amber-400'
  } else if (detectorState === 'data_delayed') {
    statusText = 'DATA DELAYED'
    statusColor = 'text-amber-400'
    statusDotColor = 'bg-amber-400'
  } else if (detectorState === 'disconnected') {
    statusText = 'OFFLINE'
    statusColor = 'text-zinc-400'
    statusDotColor = 'bg-zinc-500'
  }

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Key Metrics">
      {/* 1. System Status Card */}
      <div className="flex flex-col justify-between rounded-[8px] border border-[#262626] bg-[#111111] p-4 min-h-[130px]">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.06em] text-[#8a8a8a]">
          <span>System Status</span>
          <span className="text-[10px] text-[#5c5c5c]">
            {dataAgeSec <= 2 ? 'Live · 1.2s' : `${dataAgeSec}s ago`}
          </span>
        </div>

        <div className="flex flex-col gap-1 mt-2">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotColor} shrink-0`} />
            <span className={`text-[22px] font-semibold tracking-tight leading-none ${statusColor}`}>
              {statusText}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-[#8a8a8a] mt-1">
            <span>
              {detectorState === 'warming_up'
                ? 'Learning normal baseline'
                : detectorState === 'incident_open'
                ? `Active incident ${activeIncident?.incident_id}`
                : detectorState === 'degraded'
                ? 'Parser errors elevated'
                : 'All invariants nominal'}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[#262626]/50 flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
          <span>Last tick</span>
          <span className="text-[#ededed]">{dataAgeSec <= 2 ? '1.2s ago' : `${dataAgeSec}s ago`}</span>
        </div>
      </div>

      {/* 2. Error Rate Card with effect size */}
      <div className="flex flex-col justify-between rounded-[8px] border border-[#262626] bg-[#111111] p-4 min-h-[130px]">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.06em] text-[#8a8a8a]">
          <span>Error Rate</span>
          <span className="text-[10px] text-[#5c5c5c]">short window (30s)</span>
        </div>

        <div className="flex items-end justify-between gap-2 mt-1">
          <div className="flex flex-col gap-0.5">
            <div className="font-mono tabular-nums text-[30px] font-semibold text-[#ededed] leading-none">
              {isWarmingUp && !currentTick ? '—' : currentRateStr}
            </div>

            <div className="flex items-center gap-1.5 text-xs font-mono text-[#8a8a8a] mt-1">
              <span>Baseline:</span>
              <span className="text-[#ededed] font-medium">{baselineRateStr}</span>
              <span className="text-[#5c5c5c]">·</span>
              <span className={`font-medium ${deltaPp > 2 ? 'text-rose-400' : 'text-[#ededed]'}`}>
                {deltaStr}
              </span>
            </div>
          </div>

          <div className="hidden sm:block">
            <Sparkline
              data={rateHistory}
              color={deltaPp > 2 ? '#f43f5e' : '#e5e5e5'}
              baseline={baselineRate}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-[#262626]/50 flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
          <span>Effect size</span>
          <span className="text-[#ededed] font-medium">
            {multipleOfBaseline}× baseline
          </span>
        </div>
      </div>

      {/* 3. Traffic Volume Card */}
      <div className="flex flex-col justify-between rounded-[8px] border border-[#262626] bg-[#111111] p-4 min-h-[130px]">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.06em] text-[#8a8a8a]">
          <span>Traffic Volume</span>
          <span className="text-[10px] text-[#5c5c5c]">expected: {baselineVol}/s</span>
        </div>

        <div className="flex items-end justify-between gap-2 mt-1">
          <div className="flex flex-col gap-0.5">
            <div className="font-mono tabular-nums text-[30px] font-semibold text-[#ededed] leading-none">
              {Math.round(currentVol)}{' '}
              <span className="text-sm font-normal text-[#8a8a8a]">lines/s</span>
            </div>

            <div className="flex items-center gap-1 text-xs font-mono text-[#8a8a8a] mt-1">
              <span>{volPctOfExpected}% of expected volume</span>
            </div>
          </div>

          <div className="hidden sm:block">
            <Sparkline data={volHistory} color="#38bdf8" />
          </div>
        </div>

        <div className="pt-2 border-t border-[#262626]/50 flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
          <span>Volume delta</span>
          <span className={`font-medium ${Number(volDeltaPct) < -30 ? 'text-amber-400' : 'text-[#ededed]'}`}>
            {volDeltaSign}{volDeltaPct}%
          </span>
        </div>
      </div>

      {/* 4. Detection / Z-Score Card */}
      <div className="flex flex-col justify-between rounded-[8px] border border-[#262626] bg-[#111111] p-4 min-h-[130px]">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.06em] text-[#8a8a8a]">
          <span>Detection Hypothesis</span>
          <span className="text-[10px] text-[#5c5c5c]">threshold: 3.0σ</span>
        </div>

        <div className="flex items-end justify-between gap-2 mt-1">
          <div className="flex flex-col gap-0.5">
            <div className="font-mono tabular-nums text-[30px] font-semibold text-[#ededed] leading-none">
              {zScoreStr}
            </div>

            <div className="flex items-center gap-1 text-xs font-mono text-[#8a8a8a] mt-1">
              {isZAnomaly ? (
                <span className="text-rose-400 font-semibold">▲ Significant deviation</span>
              ) : (
                <span className="text-emerald-400 font-medium">● No anomaly</span>
              )}
            </div>
          </div>

          <div className="hidden sm:block">
            <Sparkline data={zHistory} color={isZAnomaly ? '#f43f5e' : '#10b981'} />
          </div>
        </div>

        <div className="pt-2 border-t border-[#262626]/50 flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
          <span>Open trigger</span>
          <span className="text-[#ededed] font-medium">z ≥ 3.0 &amp; Δ ≥ +2 pp</span>
        </div>
      </div>
    </section>
  )
}
