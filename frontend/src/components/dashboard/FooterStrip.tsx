import { HealthState } from '@/types/dashboard'

interface FooterStripProps {
  health: HealthState
  lastTickTs?: number
  isStale?: boolean
}

function formatHHMMSS(epochSec?: number) {
  if (!epochSec) return '--:--:--'
  const d = new Date(epochSec * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function FooterStrip({ health, lastTickTs, isStale }: FooterStripProps) {
  const lastTime = health.last_tick_ts || lastTickTs

  return (
    <footer
      className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#262626] bg-[#111111] px-4 py-2.5 text-[11px] text-[#8a8a8a]"
      aria-label="System Health"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span>Tailer Lag:</span>
          <span className="font-mono text-[#ededed]">
            {health.tailer_lag_s !== undefined ? `${health.tailer_lag_s}s` : '--'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Bad Line Ratio:</span>
          <span className="font-mono text-[#ededed]">
            {health.bad_line_ratio !== undefined ? `${(health.bad_line_ratio * 100).toFixed(2)}%` : '--'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Queue Depth:</span>
          <span className="font-mono text-[#ededed]">
            {health.queue_depth !== undefined ? health.queue_depth : '--'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isStale && (
          <span className="rounded-[4px] border border-[#262626] bg-[#171717] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#ededed]">
            Data is stale
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span>Last Tick:</span>
          <span className="font-mono text-[#ededed]">
            {formatHHMMSS(lastTime)}
          </span>
        </div>
      </div>
    </footer>
  )
}
