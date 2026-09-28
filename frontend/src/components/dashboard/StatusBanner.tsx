import { DetectorStateType, ConnectionMode, Alert } from '@/types/dashboard'
import {
  CheckCircle2,
  AlertTriangle,
  Flame,
  WifiOff,
  RefreshCw,
  Loader2,
  FileText,
  Clock,
} from 'lucide-react'

interface StatusBannerProps {
  detectorState: DetectorStateType
  connectionMode: ConnectionMode
  activeIncident: Alert | null
  lastUpdateStr: string
  linesPerSec?: number
  warmupSec?: number
  maxWarmupSec?: number
  sourceFile?: string
  badLineRatio?: number
  tailerLagSec?: number | string
  onRetryConnection?: () => void
}

export function StatusBanner({
  detectorState,
  connectionMode,
  activeIncident,
  lastUpdateStr,
  linesPerSec = 498,
  warmupSec = 0,
  maxWarmupSec = 60,
  sourceFile = 'application.log',
  badLineRatio = 0,
  tailerLagSec = '0.04',
  onRetryConnection,
}: StatusBannerProps) {
  // If disconnected or offline: persistent connection recovery banner
  if (connectionMode === 'offline' || connectionMode === 'reconnecting') {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-xs text-[#ededed]"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 shrink-0">
            {connectionMode === 'reconnecting' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-amber-300">
                {connectionMode === 'reconnecting'
                  ? 'Reconnecting to Detector API'
                  : 'Detector Disconnected (Offline)'}
              </span>
              <span className="text-[#8a8a8a] font-normal">·</span>
              <span className="text-[#8a8a8a] font-normal">
                Showing cached telemetry from {lastUpdateStr}
              </span>
            </div>
            <span className="text-[11px] text-[#8a8a8a]">
              Pipeline values remain visible. Data freshness is delayed until connection restores.
            </span>
          </div>
        </div>

        {onRetryConnection && (
          <button
            onClick={onRetryConnection}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-amber-700 bg-amber-900/40 px-3 py-1.5 font-mono text-xs font-medium text-amber-200 transition-colors hover:bg-amber-800/60 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Retry now</span>
          </button>
        )}
      </div>
    )
  }

  // WARMING UP state banner with progress bar and lines count
  if (detectorState === 'warming_up') {
    const percent = Math.min(100, Math.max(0, Math.round((warmupSec / maxWarmupSec) * 100)))
    const remainingSec = Math.max(0, maxWarmupSec - warmupSec)
    const collectedLines = Math.min(20000, Math.round(warmupSec * linesPerSec))

    return (
      <div className="flex flex-col gap-2 rounded-[8px] border border-cyan-900/60 bg-cyan-950/20 px-4 py-3 text-xs text-[#ededed]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 motion-safe:animate-pulse" />
            <span className="font-mono font-semibold tracking-wider text-cyan-300 uppercase">
              WARMING UP
            </span>
            <span className="text-[#8a8a8a]">·</span>
            <span className="text-[#ededed]">
              Learning baseline · {remainingSec}s remaining
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-[#8a8a8a]">
            <span>
              Source: <strong className="text-[#ededed] font-normal">{sourceFile}</strong>
            </span>
            <span>·</span>
            <span>
              Receiving <strong className="text-[#ededed] font-normal">{linesPerSec} lines/s</strong>
            </span>
          </div>
        </div>

        {/* Measurable Progress Bar */}
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#8a8a8a]">
            <span>Baseline sample progress: {percent}% ({warmupSec} / {maxWarmupSec}s)</span>
            <span>Collected: {collectedLines.toLocaleString()} / 20,000 lines</span>
          </div>
          <div className="h-1.5 w-full bg-[#171717] rounded-full overflow-hidden border border-[#262626]">
            <div
              className="h-full bg-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-[10px] text-[#8a8a8a] mt-0.5">
            Alerts are suppressed until the baseline accumulates sufficient traffic history.
          </div>
        </div>
      </div>
    )
  }

  // INCIDENT OPEN / ESCALATED state banner
  if (detectorState === 'incident_open' && activeIncident) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-rose-900/80 bg-rose-950/30 px-4 py-3 text-xs text-[#ededed]">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 shrink-0">
            <Flame className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold tracking-wider text-rose-400 uppercase">
                ▲ INCIDENT OPEN ({activeIncident.severity})
              </span>
              <span className="text-[#8a8a8a]">·</span>
              <span className="font-mono text-[#ededed]">
                {activeIncident.incident_id}
              </span>
              <span className="text-[#8a8a8a]">·</span>
              <span className="text-rose-200">
                Error rate {(activeIncident.error_rate * 100).toFixed(1)}% vs baseline {(activeIncident.baseline * 100).toFixed(1)}% (z = {activeIncident.z.toFixed(1)})
              </span>
            </div>
            <span className="text-[11px] text-[#8a8a8a]">
              Active anomaly detected across rolling window. Alerts dispatched to AWS SNS.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-[#8a8a8a]">
          <Clock className="w-3.5 h-3.5" />
          <span>Last tick {lastUpdateStr}</span>
        </div>
      </div>
    )
  }

  // PIPELINE DEGRADED state banner
  if (detectorState === 'degraded') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-900/70 bg-amber-950/20 px-4 py-3 text-xs text-[#ededed]">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-amber-300">▲ PIPELINE DEGRADED</span>
              <span className="text-[#8a8a8a] font-normal">·</span>
              <span className="text-[#ededed]">
                {(badLineRatio * 100).toFixed(1)}% of lines could not be parsed · Detection may be incomplete
              </span>
            </div>
            <span className="text-[11px] text-[#8a8a8a]">
              Check log format patterns or parser regex. Valid lines are still being evaluated.
            </span>
          </div>
        </div>
        <div className="font-mono text-[11px] text-[#8a8a8a]">
          Updated {lastUpdateStr}
        </div>
      </div>
    )
  }

  // DATA DELAYED state banner
  if (detectorState === 'data_delayed') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-xs text-[#ededed]">
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-amber-300">! DATA DELAYED</span>
              <span className="text-[#8a8a8a] font-normal">·</span>
              <span className="text-[#ededed]">
                Tailer lag is {tailerLagSec}s behind the file cursor
              </span>
            </div>
            <span className="text-[11px] text-[#8a8a8a]">
              Detector queue is processing buffered records.
            </span>
          </div>
        </div>
        <div className="font-mono text-[11px] text-[#8a8a8a]">
          Updated {lastUpdateStr}
        </div>
      </div>
    )
  }

  // Default HEALTHY banner
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-emerald-950 bg-emerald-950/20 px-4 py-2.5 text-xs text-[#ededed]">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono font-semibold tracking-wider text-emerald-400 uppercase">
          HEALTHY
        </span>
        <span className="text-[#8a8a8a]">·</span>
        <span className="text-[#8a8a8a]">
          No active incidents · Operating within baseline variance
        </span>
      </div>

      <div className="flex items-center gap-3 font-mono text-[11px] text-[#8a8a8a]">
        <span className="flex items-center gap-1.5">
          <FileText className="w-3 h-3 text-[#5c5c5c]" />
          <span>{sourceFile}</span>
        </span>
        <span>·</span>
        <span>Receiving {linesPerSec} lines/s</span>
        <span>·</span>
        <span>Updated {lastUpdateStr}</span>
      </div>
    </div>
  )
}
