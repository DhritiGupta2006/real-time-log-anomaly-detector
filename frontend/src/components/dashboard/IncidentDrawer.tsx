import { Alert } from '@/types/dashboard'
import {
  X,
  Check,
  Download,
  AlertTriangle,
  Flame,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Cpu,
  Layers,
  ShieldCheck,
} from 'lucide-react'

interface IncidentDrawerProps {
  alert: Alert | null
  onClose: () => void
  onAcknowledge: (incidentId: string) => void
}

function formatDuration(openedAt?: string, resolvedAt?: string) {
  if (!openedAt) return '—'
  const start = new Date(openedAt).getTime()
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function formatHHMMSS(isoString?: string) {
  if (!isoString) return '--:--:--'
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return isoString
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function IncidentDrawer({
  alert,
  onClose,
  onAcknowledge,
}: IncidentDrawerProps) {
  if (!alert) return null

  const isResolved = alert.state === 'RESOLVED'
  const ratePp = (alert.error_rate * 100).toFixed(1)
  const basePp = (alert.baseline * 100).toFixed(1)
  const deltaPp = ((alert.error_rate - alert.baseline) * 100).toFixed(1)
  const duration = formatDuration(alert.opened_at, alert.resolved_at)

  const exportIncidentJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(alert, null, 2))
    const dlAnchor = document.createElement('a')
    dlAnchor.setAttribute('href', dataStr)
    dlAnchor.setAttribute('download', `${alert.incident_id}.json`)
    dlAnchor.click()
  }

  // Derive transitions if not explicitly attached
  const transitions = alert.transitions || [
    {
      timestamp: alert.opened_at,
      toState: 'OPEN',
      severity: alert.severity === 'CRITICAL' ? 'HIGH' : alert.severity,
      message: `Incident opened as ${alert.severity === 'CRITICAL' ? 'HIGH' : alert.severity} (z = ${(alert.z - 2.5).toFixed(1)})`,
    },
    ...(alert.state === 'ESCALATED' || alert.peak_severity === 'CRITICAL'
      ? [
          {
            timestamp: alert.updated_at,
            toState: 'ESCALATED',
            severity: 'CRITICAL' as const,
            message: `Escalated to CRITICAL: error rate reached ${ratePp}% (z = ${alert.z.toFixed(1)})`,
          },
        ]
      : []),
    ...(isResolved
      ? [
          {
            timestamp: alert.resolved_at || alert.updated_at,
            toState: 'RESOLVED',
            severity: 'LOW' as const,
            message: `Recovered: short-window rate dropped below baseline threshold`,
          },
        ]
      : []),
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px] transition-opacity"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Incident details for ${alert.incident_id}`}
    >
      <div
        className="relative flex h-full w-full max-w-[460px] flex-col border-l border-[#262626] bg-[#111111] p-6 shadow-2xl overflow-y-auto overscroll-contain animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between border-b border-[#262626] pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-[6px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                  alert.severity === 'CRITICAL'
                    ? 'bg-rose-500 text-black'
                    : alert.severity === 'HIGH'
                    ? 'bg-orange-500 text-black'
                    : alert.severity === 'MEDIUM'
                    ? 'border border-amber-600 text-amber-300'
                    : 'border border-[#737373] text-[#a3a3a3]'
                }`}
              >
                {alert.severity}
              </span>
              <span className="font-mono text-sm font-semibold text-[#ededed]">
                {alert.incident_id}
              </span>
              <span className="text-[#8a8a8a] text-xs">·</span>
              <span className="font-mono text-xs text-[#8a8a8a]">
                {alert.alert_type || alert.type_ || 'ERROR_RATE'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
              <span>Duration: <strong className="font-mono text-[#ededed] font-normal">{duration}</strong></span>
              <span>·</span>
              <span>Opened {formatHHMMSS(alert.opened_at)}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#8a8a8a] hover:bg-[#171717] hover:text-[#ededed] transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary Operational Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 py-5 border-b border-[#262626]">
          <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-[#8a8a8a]">Current State</span>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  alert.state === 'OPEN'
                    ? 'bg-amber-400'
                    : alert.state === 'ESCALATED'
                    ? 'bg-rose-500 motion-safe:animate-pulse'
                    : 'bg-emerald-400'
                }`}
              />
              <span className="font-mono text-sm font-semibold text-[#ededed]">
                {alert.state}
              </span>
            </div>
            {alert.acknowledged && (
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
                <Check className="w-3 h-3" /> Acknowledged by On-Call
              </span>
            )}
          </div>

          <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-[#8a8a8a]">Z-Score (Significance)</span>
            <div className="font-mono text-sm font-semibold text-[#ededed]">
              z = {alert.z.toFixed(2)}
            </div>
            <span className="text-[10px] text-[#8a8a8a]">Threshold: 3.00</span>
          </div>

          <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-[#8a8a8a]">Error Rate</span>
            <div className="font-mono text-sm font-semibold text-[#ededed]">
              {ratePp}%
            </div>
            <span className="text-[10px] text-[#8a8a8a]">
              Baseline: {basePp}%
            </span>
          </div>

          <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-[#8a8a8a]">Effect Size</span>
            <div className="font-mono text-sm font-semibold text-[#ededed]">
              +{deltaPp} pp
            </div>
            <span className="text-[10px] text-[#8a8a8a]">
              {alert.baseline > 0 ? (alert.error_rate / alert.baseline).toFixed(1) : '∞'}× baseline
            </span>
          </div>
        </div>

        {/* Why this alert fired explanation */}
        <div className="py-4 border-b border-[#262626] flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#ededed]">
            <Cpu className="w-3.5 h-3.5 text-[#ededed]" />
            <span>Why this alert fired</span>
          </div>
          <div className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs text-[#8a8a8a] leading-relaxed">
            {alert.explanation ||
              `The short-window rate (${ratePp}%) exceeded the statistical threshold (z = ${alert.z.toFixed(1)} ≥ 3.0) and satisfied the minimum effect size condition (+${deltaPp} pp ≥ +2.0 pp above baseline). Evaluated over a ${alert.window_s || 30}-second rolling sample window.`}
          </div>
        </div>

        {/* Transition History Timeline */}
        <div className="py-4 border-b border-[#262626] flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#ededed] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#8a8a8a]" />
              <span>State Transition Timeline</span>
            </span>
            <span className="text-[10px] font-mono text-[#8a8a8a]">
              {transitions.length} event{transitions.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex flex-col gap-3 relative pl-3 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[1px] before:bg-[#262626]">
            {transitions.map((t, idx) => (
              <div key={idx} className="relative flex flex-col gap-1 pl-3 text-xs">
                <div className="absolute -left-[14px] top-1 h-2 w-2 rounded-full border border-[#0a0a0a] bg-[#8a8a8a]" />
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="font-semibold text-[#ededed]">{t.toState}</span>
                  <span className="text-[#8a8a8a]">{formatHHMMSS(t.timestamp)}</span>
                </div>
                <p className="text-[11px] text-[#8a8a8a] leading-normal">{t.message}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Top error messages */}
        {alert.top_errors && alert.top_errors.length > 0 && (
          <div className="py-4 border-b border-[#262626] flex flex-col gap-2">
            <span className="text-xs font-semibold text-[#ededed]">
              Top Error Signatures in Window
            </span>
            <div className="flex flex-col gap-1.5">
              {alert.top_errors.map((err, i) => (
                <div
                  key={i}
                  className="rounded-[6px] border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 font-mono text-[11px] text-[#ededed] break-all"
                >
                  {err}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Drawer Action Buttons */}
        <div className="mt-auto pt-6 flex items-center justify-between gap-3">
          <button
            onClick={() => onAcknowledge(alert.incident_id)}
            disabled={alert.acknowledged}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[8px] py-2 text-xs font-semibold transition-colors cursor-pointer ${
              alert.acknowledged
                ? 'border border-[#262626] bg-[#171717] text-[#8a8a8a] cursor-default'
                : 'bg-[#ededed] text-[#0a0a0a] hover:bg-[#ffffff]'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{alert.acknowledged ? 'Acknowledged' : 'Acknowledge'}</span>
          </button>

          <button
            onClick={exportIncidentJson}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-3.5 py-2 text-xs font-mono text-[#ededed] hover:border-[#5c5c5c] hover:bg-[#171717] transition-colors cursor-pointer"
            title="Download full incident record JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>
    </div>
  )
}
