import { useState, useEffect } from 'react'
import { Alert, SystemStatus, Severity, IncidentState } from '@/types/dashboard'
import {
  Download,
  Flame,
  Check,
  ChevronRight,
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react'

interface AlertFeedProps {
  alerts: Alert[]
  flashAlertId: string | null
  systemStatus?: SystemStatus
  onSelectAlert: (alert: Alert) => void
  onAcknowledgeAlert: (incidentId: string) => void
}

type FilterState = 'all' | 'open' | 'escalated' | 'resolved'
type SeverityFilter = 'all' | Severity

function getRelativeTime(isoStringOrSeconds?: string | number) {
  if (!isoStringOrSeconds) return ''
  let pastMs: number
  if (typeof isoStringOrSeconds === 'number') {
    pastMs = isoStringOrSeconds > 1e11 ? isoStringOrSeconds : isoStringOrSeconds * 1000
  } else {
    pastMs = new Date(isoStringOrSeconds).getTime()
  }
  if (isNaN(pastMs)) return ''

  const diffSec = Math.max(0, Math.floor((Date.now() - pastMs) / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

function formatDuration(openedAt?: string, resolvedAt?: string) {
  if (!openedAt) return '—'
  const start = new Date(openedAt).getTime()
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m ${remSec}s`
}

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function AlertFeed({
  alerts,
  flashAlertId,
  systemStatus,
  onSelectAlert,
  onAcknowledgeAlert,
}: AlertFeedProps) {
  const [stateFilter, setStateFilter] = useState<FilterState>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeAlerts = alerts.filter((a) => a.state === 'OPEN' || a.state === 'ESCALATED')
  const openCount = activeAlerts.length
  const resolvedCount = alerts.filter((a) => a.state === 'RESOLVED').length
  const escalatedCount = alerts.filter((a) => a.state === 'ESCALATED').length

  const filteredAlerts = alerts.filter((a) => {
    if (stateFilter === 'open' && a.state !== 'OPEN') return false
    if (stateFilter === 'escalated' && a.state !== 'ESCALATED') return false
    if (stateFilter === 'resolved' && a.state !== 'RESOLVED') return false
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false
    return true
  })

  const exportCsv = () => {
    if (alerts.length === 0) return

    const headers = [
      'incident_id',
      'alert_type',
      'state',
      'severity',
      'error_rate',
      'baseline',
      'z',
      'duration',
      'opened_at',
      'updated_at',
      'top_errors',
    ]

    const rows = alerts.map((a) => [
      escapeCsvField(a.incident_id),
      escapeCsvField(a.alert_type || a.type_ || 'ERROR_RATE'),
      escapeCsvField(a.state),
      escapeCsvField(a.severity),
      escapeCsvField((a.error_rate * 100).toFixed(2)),
      escapeCsvField((a.baseline * 100).toFixed(2)),
      escapeCsvField(a.z !== undefined ? a.z.toFixed(2) : ''),
      escapeCsvField(formatDuration(a.opened_at, a.resolved_at)),
      escapeCsvField(a.opened_at),
      escapeCsvField(a.updated_at),
      escapeCsvField(Array.isArray(a.top_errors) ? a.top_errors.join('; ') : ''),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `incident-alerts-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const isWarmingUp = systemStatus === 'WARMING_UP'

  return (
    <section className="flex flex-col gap-4 rounded-[8px] border border-[#262626] bg-[#111111] p-4" aria-label="Incident Alerts Feed">
      {/* 1. Dominant Active Incident Callout Banner (when incidents are open) */}
      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[8px] border border-rose-900/80 bg-rose-950/20 p-4 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-rose-900/40 pb-2.5">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-rose-400" />
              <span className="font-mono text-xs font-bold tracking-wider text-rose-400 uppercase">
                {activeAlerts.length} ACTIVE INCIDENT{activeAlerts.length === 1 ? '' : 'S'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-rose-300/80">
              Notification status: PagerDuty / CloudWatch active
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {activeAlerts.slice(0, 2).map((inc) => {
              const ratePp = (inc.error_rate * 100).toFixed(1)
              const basePp = (inc.baseline * 100).toFixed(1)
              const dur = formatDuration(inc.opened_at, inc.resolved_at)

              return (
                <div
                  key={inc.incident_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-rose-900/50 bg-[#0a0a0a] p-3 text-xs"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-[4px] px-1.5 py-0.2 font-mono text-[10px] font-bold uppercase ${
                          inc.severity === 'CRITICAL'
                            ? 'bg-rose-500 text-black'
                            : 'bg-orange-500 text-black'
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <span className="font-mono font-semibold text-[#ededed]">
                        {inc.alert_type || 'ERROR_RATE'}
                      </span>
                      <span className="font-mono text-[#8a8a8a]">· {inc.incident_id}</span>
                      <span
                        className={`rounded-[4px] px-1.5 py-0.2 font-mono text-[10px] ${
                          inc.state === 'ESCALATED' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'text-amber-400'
                        }`}
                      >
                        {inc.state}
                      </span>
                    </div>

                    <div className="text-[#ededed] font-medium mt-0.5">
                      Error rate increased to <strong className="text-rose-400">{ratePp}%</strong>, baseline is {basePp}%
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#8a8a8a]">
                      <span>Opened {getRelativeTime(inc.opened_at)}</span>
                      <span>·</span>
                      <span>z = {inc.z.toFixed(1)}</span>
                      <span>·</span>
                      <span>{inc.volume ?? 510} lines/s</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onAcknowledgeAlert(inc.incident_id)}
                      disabled={inc.acknowledged}
                      className={`inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-xs font-medium cursor-pointer ${
                        inc.acknowledged
                          ? 'border border-[#262626] bg-[#171717] text-[#8a8a8a] cursor-default'
                          : 'border border-[#5c5c5c] bg-[#171717] text-[#ededed] hover:bg-[#262626]'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      <span>{inc.acknowledged ? 'Acknowledged' : 'Acknowledge'}</span>
                    </button>

                    <button
                      onClick={() => onSelectAlert(inc)}
                      className="inline-flex items-center gap-1 rounded-[6px] bg-[#ededed] px-3 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-[#ffffff] transition-colors cursor-pointer"
                    >
                      <span>View details</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. Controls & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] pb-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-[#ededed]">
            Incident Feed &amp; Audit Log
          </h2>
          <span className="rounded-full border border-[#262626] bg-[#171717] px-2 py-0.5 font-mono text-[11px] text-[#8a8a8a]">
            {alerts.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Export CSV button */}
          <button
            onClick={exportCsv}
            disabled={alerts.length === 0}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#262626] bg-[#171717] px-2.5 py-1 text-xs font-mono text-[#ededed] transition-colors hover:border-[#5c5c5c] hover:bg-[#262626] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title={alerts.length === 0 ? 'No alerts to export' : 'Export incident records as CSV'}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          {/* State Filter Tabs */}
          <div className="flex items-center gap-1 rounded-[6px] border border-[#262626] bg-[#0a0a0a] p-0.5" role="tablist">
            {(
              [
                { id: 'all', label: `All ${alerts.length}` },
                { id: 'open', label: `Open ${openCount}` },
                { id: 'escalated', label: `Escalated ${escalatedCount}` },
                { id: 'resolved', label: `Resolved ${resolvedCount}` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setStateFilter(t.id)}
                role="tab"
                aria-selected={stateFilter === t.id}
                className={`rounded-[4px] px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  stateFilter === t.id
                    ? 'bg-[#171717] text-[#ededed] shadow-sm'
                    : 'text-[#8a8a8a] hover:text-[#ededed]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Severity selector */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="rounded-[6px] border border-[#262626] bg-[#0a0a0a] px-2 py-1 font-mono text-xs text-[#ededed] cursor-pointer focus:border-[#5c5c5c] focus:outline-none"
            aria-label="Filter by severity"
          >
            <option value="all">All Severities</option>
            <option value="CRITICAL">Critical only</option>
            <option value="HIGH">High only</option>
            <option value="MEDIUM">Medium only</option>
            <option value="LOW">Low only</option>
          </select>
        </div>
      </div>

      {/* 3. Alerts Feed List */}
      <div className="flex flex-col gap-2" aria-live="polite">
        {filteredAlerts.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[#262626] py-10 text-center text-xs text-[#8a8a8a] flex flex-col items-center justify-center gap-1.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-500/60" />
            <span>
              {isWarmingUp
                ? 'Alerts begin evaluating after initial baseline learning finishes.'
                : 'No incidents match current filter. Detector is within normal parameters.'}
            </span>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isFlashing = alert.incident_id === flashAlertId
            const isCritical = alert.severity === 'CRITICAL'
            const rateStr = `${(alert.error_rate * 100).toFixed(1)}%`
            const baseStr = `${(alert.baseline * 100).toFixed(1)}%`
            const deltaPp = ((alert.error_rate - alert.baseline) * 100).toFixed(1)
            const duration = formatDuration(alert.opened_at, alert.resolved_at)

            return (
              <div
                key={alert.incident_id}
                onClick={() => onSelectAlert(alert)}
                className={`group flex min-h-[48px] flex-col rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 transition-all cursor-pointer hover:border-[#5c5c5c] hover:bg-[#141414] ${
                  isCritical ? 'border-l-2 border-l-rose-500' : ''
                } ${isFlashing ? 'motion-safe:animate-pulse' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                    {/* Severity Badge */}
                    <span
                      className={`rounded-[4px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
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

                    {/* Incident ID */}
                    <span className="font-mono text-xs font-semibold text-[#ededed]">
                      {alert.incident_id}
                    </span>

                    {/* State Chip */}
                    <span
                      className={`rounded-[4px] px-1.5 py-0.2 font-mono text-[10px] uppercase ${
                        alert.state === 'ESCALATED'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : alert.state === 'OPEN'
                          ? 'border border-amber-700 bg-amber-950/40 text-amber-300'
                          : 'text-[#8a8a8a]'
                      }`}
                    >
                      {alert.state}
                    </span>

                    {/* Alert Type */}
                    <span className="rounded-[4px] border border-[#262626] bg-[#111111] px-1.5 py-0.2 font-mono text-[10px] text-[#8a8a8a]">
                      {alert.alert_type || alert.type_ || 'ERROR_RATE'}
                    </span>

                    {/* Short explanatory phrase */}
                    <span className="text-xs text-[#ededed] hidden md:inline">
                      Error rate {rateStr} vs baseline {baseStr} (+{deltaPp} pp)
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-[#8a8a8a]">
                    <span className="font-mono text-[11px] text-[#8a8a8a] hidden sm:inline">
                      z = {alert.z.toFixed(1)}
                    </span>

                    <span className="font-mono text-[11px] text-[#8a8a8a]">
                      Dur: {duration}
                    </span>

                    {alert.acknowledged && (
                      <span className="rounded-[4px] border border-emerald-900 bg-emerald-950/40 px-1.5 py-0.2 font-mono text-[10px] text-emerald-300">
                        Acked
                      </span>
                    )}

                    <span className="font-mono text-[11px] text-[#5c5c5c]">
                      {getRelativeTime(alert.updated_at || alert.opened_at)}
                    </span>

                    <ChevronRight className="w-4 h-4 text-[#5c5c5c] group-hover:text-[#ededed] transition-colors" />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
