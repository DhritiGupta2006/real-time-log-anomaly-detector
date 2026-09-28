import { useRef, useEffect, useState } from 'react'
import { Tick, Alert, DetectorStateType } from '@/types/dashboard'
import { SevenDayTrendline } from './SevenDayTrendline'

interface MetricsChartProps {
  ticks: Tick[]
  activeIncident: Alert | null
  alerts?: Alert[]
  detectorState?: DetectorStateType
  isDisconnectedAndNoData?: boolean
  lastUpdateStr?: string
  dataAgeSec?: number
}

type TimeRange = '60s' | '5m' | '15m' | '1h'

function formatHHMMSS(epochSec?: number) {
  if (!epochSec) return '--:--:--'
  const d = new Date(epochSec * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function getNiceYAxis(maxVal: number) {
  const rawStep = maxVal / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 0.01)))
  const norm = rawStep / mag
  let step: number
  if (norm <= 1.2) step = 1 * mag
  else if (norm <= 2.5) step = 2 * mag
  else if (norm <= 7) step = 5 * mag
  else step = 10 * mag

  if (maxVal >= 0.05 && step < 0.01) step = 0.01

  const yMax = Math.ceil(maxVal / step) * step
  const count = Math.round(yMax / step)
  const ticksList: number[] = []
  for (let i = 0; i <= count; i++) {
    ticksList.push(Number((i * step).toFixed(5)))
  }
  return { yMax, step, ticksList }
}

export function MetricsChart({
  ticks,
  activeIncident,
  alerts = [],
  detectorState = 'healthy',
  isDisconnectedAndNoData,
  lastUpdateStr = '--:--:--',
  dataAgeSec = 0,
}: MetricsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>('60s')

  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined
  const latestRateStr = latestTick ? `${(latestTick.rate * 100).toFixed(1)}%` : '—'
  const latestBaseStr = latestTick ? `${(latestTick.baseline * 100).toFixed(1)}%` : '—'
  const latestZStr = latestTick?.z !== undefined ? latestTick.z.toFixed(2) : '—'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height

    ctx.clearRect(0, 0, width, height)

    const padding = { top: 28, right: 35, bottom: 25, left: 45 }
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom

    const highestVal =
      ticks.length > 0
        ? Math.max(0, ...ticks.map((t) => Math.max(t.rate || 0, (t.baseline || 0.02) + 0.02, 0.10)))
        : 0.12
    const suggestedMax = Math.min(1.0, Math.max(0.12, 1.15 * highestVal))

    const { yMax, step, ticksList } = getNiceYAxis(suggestedMax)
    const isStepSubOnePercent = step < 0.0099

    // Horizontal grid lines & Y labels
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#8a8a8a'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'

    ticksList.forEach((val) => {
      const y = padding.top + plotHeight - (val / yMax) * plotHeight

      ctx.strokeStyle = '#222222'
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()

      const label = isStepSubOnePercent ? `${(val * 100).toFixed(1)}%` : `${Math.round(val * 100)}%`
      ctx.fillText(label, padding.left - 8, y)
    })

    // Absolute 10% ceiling reference line
    if (0.10 <= yMax) {
      const y10 = padding.top + plotHeight - (0.10 / yMax) * plotHeight
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(padding.left, y10)
      ctx.lineTo(width - padding.right, y10)
      ctx.stroke()

      ctx.fillStyle = 'rgba(239, 68, 68, 0.6)'
      ctx.textAlign = 'right'
      ctx.fillText('10% ceiling', width - padding.right, y10 - 6)
    }

    if (ticks.length < 2) {
      return
    }

    // 1. Shaded Baseline Normal Range Band (baseline ± expected variation, e.g. 0.006)
    ctx.beginPath()
    const baselineUpperPoints: { x: number; y: number }[] = []
    const baselineLowerPoints: { x: number; y: number }[] = []

    ticks.forEach((tick, i) => {
      const x = padding.left + (i / (ticks.length - 1)) * plotWidth
      const variation = tick.expected_variation ?? 0.005
      const upper = Math.min(yMax, (tick.baseline || 0.02) + variation)
      const lower = Math.max(0, (tick.baseline || 0.02) - variation)

      const yUpper = padding.top + plotHeight - (upper / yMax) * plotHeight
      const yLower = padding.top + plotHeight - (lower / yMax) * plotHeight

      baselineUpperPoints.push({ x, y: yUpper })
      baselineLowerPoints.push({ x, y: yLower })
    })

    // Draw shaded band polygon
    ctx.fillStyle = 'rgba(16, 185, 129, 0.06)'
    ctx.beginPath()
    baselineUpperPoints.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y)
      else ctx.lineTo(pt.x, pt.y)
    })
    for (let i = baselineLowerPoints.length - 1; i >= 0; i--) {
      ctx.lineTo(baselineLowerPoints[i].x, baselineLowerPoints[i].y)
    }
    ctx.closePath()
    ctx.fill()

    // Shaded Incident Band (if active incident exists)
    if (activeIncident) {
      const openedAtSec = activeIncident.opened_at ? new Date(activeIncident.opened_at).getTime() / 1000 : 0
      let startIdx = -1

      if (openedAtSec > 0) {
        startIdx = ticks.findIndex((t) => t.ts >= openedAtSec)
      }
      if (startIdx === -1) {
        startIdx = ticks.findIndex((t) => t.status === 'ANOMALY')
      }
      if (startIdx === -1) {
        startIdx = Math.max(0, ticks.length - 18)
      }

      const startX = padding.left + (startIdx / (ticks.length - 1)) * plotWidth
      const endX = padding.left + plotWidth

      ctx.fillStyle = 'rgba(244, 63, 94, 0.09)'
      ctx.fillRect(startX, padding.top, endX - startX, plotHeight)

      // Left edge line
      ctx.strokeStyle = '#f43f5e'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 2])
      ctx.beginPath()
      ctx.moveTo(startX, padding.top)
      ctx.lineTo(startX, padding.top + plotHeight)
      ctx.stroke()

      // Incident Flag / Tag
      ctx.fillStyle = '#f43f5e'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`▲ ${activeIncident.incident_id} (${activeIncident.severity})`, startX + 6, padding.top + 12)
    }

    // Series 2: Baseline dashed line #737373
    ctx.strokeStyle = '#737373'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()

    ticks.forEach((tick, i) => {
      const x = padding.left + (i / (ticks.length - 1)) * plotWidth
      const y = padding.top + plotHeight - ((tick.baseline || 0) / yMax) * plotHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Series 1: Error rate line #ededed (solid, 2px)
    ctx.strokeStyle = '#ededed'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()

    ticks.forEach((tick, i) => {
      const x = padding.left + (i / (ticks.length - 1)) * plotWidth
      const y = padding.top + plotHeight - ((tick.rate || 0) / yMax) * plotHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Current value marker at rightmost point
    if (latestTick) {
      const lastX = padding.left + plotWidth
      const lastY = padding.top + plotHeight - ((latestTick.rate || 0) / yMax) * plotHeight

      ctx.fillStyle = latestTick.rate > 0.05 ? '#f43f5e' : '#ffffff'
      ctx.beginPath()
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2)
      ctx.fill()

      // Current rate callout badge on right margin
      ctx.fillStyle = latestTick.rate > 0.05 ? '#f43f5e' : '#ededed'
      ctx.font = 'bold 10px "JetBrains Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`${(latestTick.rate * 100).toFixed(1)}%`, lastX + 6, lastY + 3)
    }

    // X-axis time labels
    ctx.fillStyle = '#8a8a8a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.setLineDash([])

    const labelCount = Math.min(6, ticks.length)
    const stepX = Math.floor(ticks.length / (labelCount - 1)) || 1
    for (let i = 0; i < ticks.length; i += stepX) {
      const x = padding.left + (i / (ticks.length - 1)) * plotWidth
      const timeStr = formatHHMMSS(ticks[i].ts)
      ctx.fillText(timeStr, x, padding.top + plotHeight + 6)
    }

    // Hover crosshair and point
    if (hoverIndex !== null && ticks[hoverIndex]) {
      const x = padding.left + (hoverIndex / (ticks.length - 1)) * plotWidth
      const yRate = padding.top + plotHeight - ((ticks[hoverIndex].rate || 0) / yMax) * plotHeight

      ctx.strokeStyle = '#737373'
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotHeight)
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, yRate, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [ticks, activeIncident, hoverIndex, timeRange])

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || ticks.length < 2) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const padding = { top: 28, right: 35, bottom: 25, left: 45 }
    const plotWidth = rect.width - padding.left - padding.right

    if (x < padding.left || x > rect.width - padding.right) {
      setHoverIndex(null)
      setTooltipPos(null)
      return
    }

    const relX = (x - padding.left) / plotWidth
    const idx = Math.min(ticks.length - 1, Math.max(0, Math.round(relX * (ticks.length - 1))))
    setHoverIndex(idx)
    setTooltipPos({ x: e.clientX - rect.left, y })
  }

  const handleMouseLeave = () => {
    setHoverIndex(null)
    setTooltipPos(null)
  }

  const hoveredTick = hoverIndex !== null ? ticks[hoverIndex] : null

  return (
    <section
      className="relative flex flex-col gap-3 rounded-[8px] border border-[#262626] bg-[#111111] p-4 min-h-[340px]"
      aria-label="Real-Time Error Rate & Baseline Telemetry"
    >
      {/* Chart Top Controls & Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626]/60 pb-3">
        {/* Left: Title & Legend with Live Values */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[#ededed]">
            Error Rate &amp; Learned Baseline
          </span>

          <div className="flex flex-wrap items-center gap-3.5 text-xs">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="h-0.5 w-3.5 bg-[#ededed] rounded-full" />
              <span className="text-[#8a8a8a]">Error rate:</span>
              <span className="text-[#ededed] font-medium">{latestRateStr}</span>
            </div>

            <div className="flex items-center gap-1.5 font-mono">
              <span className="h-0 w-3.5 border-t border-dashed border-[#737373]" />
              <span className="text-[#8a8a8a]">Baseline:</span>
              <span className="text-[#ededed] font-medium">{latestBaseStr}</span>
            </div>

            <div className="flex items-center gap-1.5 font-mono">
              <span className="h-2 w-3 rounded bg-emerald-950/60 border border-emerald-800" />
              <span className="text-[#8a8a8a]">Normal band</span>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a8a] hidden lg:flex">
              <span>z = {latestZStr}</span>
            </div>
          </div>
        </div>

        {/* Right: Time Range Buttons & Trendline */}
        <div className="flex flex-wrap items-center gap-3">
          <SevenDayTrendline
            incidentCount={12 + alerts.length}
            data={[1, 2, 1, 3, 2, 2, 1 + (alerts.length ? 1 : 0)]}
          />

          <div className="flex items-center rounded-[6px] border border-[#262626] bg-[#0a0a0a] p-0.5">
            {(['60s', '5m', '15m', '1h'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-colors cursor-pointer ${
                  timeRange === r
                    ? 'bg-[#171717] text-[#ededed] font-medium'
                    : 'text-[#8a8a8a] hover:text-[#ededed]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative h-[240px] w-full">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="h-full w-full cursor-crosshair"
        />

        {/* Distinct Operational Empty States */}
        {ticks.length < 2 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-[8px] border border-[#262626] bg-[#111111]/95 px-4 py-3 text-xs text-[#8a8a8a] text-center max-w-[380px] shadow-lg flex flex-col gap-1">
              {isDisconnectedAndNoData ? (
                <>
                  <strong className="text-amber-400 font-medium">Detector Disconnected</strong>
                  <span>Can't reach the detector API. Retrying automatically or turn on Simulation in top bar.</span>
                </>
              ) : detectorState === 'warming_up' ? (
                <>
                  <strong className="text-cyan-300 font-medium">Warming Up Baseline</strong>
                  <span>The chart will appear after the detector receives enough initial traffic ticks.</span>
                </>
              ) : dataAgeSec > 10 ? (
                <>
                  <strong className="text-amber-400 font-medium">No Data Received</strong>
                  <span>The log file has not produced a tick in {dataAgeSec} seconds. Tailer is waiting.</span>
                </>
              ) : (
                <>
                  <strong className="text-[#ededed] font-medium">Waiting for log stream</strong>
                  <span>Buffering incoming events from application.log...</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Detailed Hover Tooltip */}
        {hoveredTick && tooltipPos && (
          <div
            className="pointer-events-none absolute z-20 flex flex-col gap-1.5 rounded-[8px] border border-[#262626] bg-[#171717] p-3 font-mono text-xs shadow-xl"
            style={{
              left: Math.min(window.innerWidth - 220, Math.max(10, tooltipPos.x + 14)),
              top: Math.max(10, tooltipPos.y - 75),
            }}
          >
            <div className="flex items-center justify-between border-b border-[#262626] pb-1 text-[11px]">
              <span className="font-semibold text-[#ededed]">{formatHHMMSS(hoveredTick.ts)}</span>
              <span
                className={`rounded-[4px] px-1 py-0.2 text-[10px] ${
                  hoveredTick.status === 'ANOMALY'
                    ? 'bg-rose-950 text-rose-300'
                    : 'bg-emerald-950 text-emerald-300'
                }`}
              >
                {hoveredTick.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div>
                <span className="text-[#8a8a8a]">Error Rate:</span>{' '}
                <strong className="text-[#ededed]">{(hoveredTick.rate * 100).toFixed(1)}%</strong>
              </div>
              <div>
                <span className="text-[#8a8a8a]">Baseline:</span>{' '}
                <span className="text-[#ededed]">{(hoveredTick.baseline * 100).toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-[#8a8a8a]">Volume:</span>{' '}
                <span className="text-[#ededed]">{Math.round(hoveredTick.volume)}/s</span>
              </div>
              <div>
                <span className="text-[#8a8a8a]">z-score:</span>{' '}
                <strong className={hoveredTick.z >= 3 ? 'text-rose-400' : 'text-[#ededed]'}>
                  {hoveredTick.z.toFixed(2)}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
