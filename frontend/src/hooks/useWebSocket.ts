import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Tick,
  Alert,
  HealthState,
  ConnectionMode,
  SystemStatus,
  DetectorStateType,
  SimulationScenarioId,
} from '@/types/dashboard'

const MAX_TICKS = 60
const ORIGINAL_TITLE = 'Log Anomaly Detector'

export function useWebSocket() {
  const [ticks, setTicks] = useState<Tick[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [activeIncident, setActiveIncident] = useState<Alert | null>(null)
  const [status, setStatus] = useState<SystemStatus>('WARMING_UP')
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('reconnecting')
  const [retryCountdown, setRetryCountdown] = useState<number>(4)
  const [failedAttempts, setFailedAttempts] = useState<number>(0)
  const [health, setHealth] = useState<HealthState>({
    tailer_lag_s: '0.04',
    bad_line_ratio: 0.0,
    queue_depth: 4,
    last_tick_ts: Math.floor(Date.now() / 1000),
    bytes_processed_mb: 18.4,
    source_file: 'application.log',
  })

  const [isMock, setIsMock] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('mock') === '1'
    }
    return false
  })

  const [activeScenario, setActiveScenario] = useState<SimulationScenarioId>('step_25')
  const [scenarioRemainingSec, setScenarioRemainingSec] = useState<number>(45)
  const [flashAlertId, setFlashAlertId] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMessageTsRef = useRef<number>(Date.now())
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const simTickCounterRef = useRef(0)
  const simIncidentCounterRef = useRef(1)
  const currentSimIncidentRef = useRef<Alert | null>(null)

  // In-place alert upsert handler
  const upsertAlert = useCallback((alertData: Alert, isNew: boolean = false) => {
    if (!alertData || !alertData.incident_id) return

    setAlerts((prevAlerts) => {
      const idx = prevAlerts.findIndex((a) => a.incident_id === alertData.incident_id)
      let nextAlerts: Alert[]
      if (idx >= 0) {
        nextAlerts = [...prevAlerts]
        nextAlerts[idx] = { ...nextAlerts[idx], ...alertData }
      } else {
        nextAlerts = [alertData, ...prevAlerts]
        if (isNew) {
          setFlashAlertId(alertData.incident_id)
          setTimeout(() => setFlashAlertId(null), 1300)
        }
      }

      if (alertData.state === 'OPEN' || alertData.state === 'ESCALATED') {
        setActiveIncident(alertData)
      } else if (alertData.state === 'RESOLVED') {
        const openOne = nextAlerts.find(
          (a) => (a.state === 'OPEN' || a.state === 'ESCALATED') && a.incident_id !== alertData.incident_id
        )
        setActiveIncident(openOne || null)
      }

      // Discreet tab title alert on CRITICAL
      if (
        alertData.severity === 'CRITICAL' &&
        (alertData.state === 'OPEN' || alertData.state === 'ESCALATED')
      ) {
        if (typeof document !== 'undefined' && document.hidden) {
          document.title = '(!) ' + ORIGINAL_TITLE
        }
      }

      return nextAlerts
    })
  }, [])

  // Acknowledge incident
  const acknowledgeIncident = useCallback((incidentId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.incident_id === incidentId ? { ...a, acknowledged: true } : a))
    )
    setActiveIncident((prev) => (prev?.incident_id === incidentId ? { ...prev, acknowledged: true } : prev))
  }, [])

  // Central message dispatcher
  const handleMessage = useCallback(
    (msg: any) => {
      lastMessageTsRef.current = Date.now()
      if (!msg || !msg.type) return

      switch (msg.type) {
        case 'snapshot':
          if (Array.isArray(msg.ticks)) {
            const clamped = msg.ticks.slice(-MAX_TICKS)
            setTicks(clamped)
            if (clamped.length > 0) {
              setStatus(clamped[clamped.length - 1].status || 'NORMAL')
            }
          }
          if (Array.isArray(msg.alerts)) {
            setAlerts(msg.alerts)
          }
          if (msg.active_incident !== undefined) {
            setActiveIncident(msg.active_incident)
          }
          break

        case 'tick':
          setTicks((prev) => {
            const next = [...prev, msg]
            if (next.length > MAX_TICKS) next.shift()
            return next
          })
          if (msg.status) {
            setStatus(msg.status)
          }
          break

        case 'alert':
          upsertAlert(msg, true)
          break

        case 'heartbeat':
          break

        default:
          break
      }
    },
    [upsertAlert]
  )

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
  }, [])

  const pollState = useCallback(async () => {
    if (isMock) return
    try {
      const res = await fetch('/api/state')
      if (!res.ok) return
      const data = await res.json()
      lastMessageTsRef.current = Date.now()

      if (data.tick) {
        handleMessage({ type: 'tick', ...data.tick })
      }
      if (Array.isArray(data.alerts_recent)) {
        data.alerts_recent.forEach((a: Alert) => upsertAlert(a, false))
      }
      if (data.active_incident !== undefined) {
        setActiveIncident(data.active_incident)
      }
      if (data.status) {
        setStatus(data.status)
      }
    } catch {
      // Backend unavailable
    }
  }, [isMock, handleMessage, upsertAlert])

  const connectWS = useCallback(() => {
    if (isMock || typeof window === 'undefined') return

    clearReconnectTimers()

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        wsRef.current.close()
      } catch {}
      wsRef.current = null
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
        setFailedAttempts(0)
        setConnectionMode('live')
        stopPolling()
        clearReconnectTimers()
      }

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data)
          handleMessage(parsed)
        } catch {}
      }

      ws.onerror = () => {
        triggerDisconnect()
      }

      ws.onclose = () => {
        triggerDisconnect()
      }
    } catch {
      triggerDisconnect()
    }
  }, [isMock, stopPolling, handleMessage, clearReconnectTimers])

  const triggerDisconnect = useCallback(() => {
    if (isMock) return

    reconnectAttemptsRef.current++
    const attempts = reconnectAttemptsRef.current
    setFailedAttempts(attempts)

    if (attempts >= 8) {
      setConnectionMode('offline')
      clearReconnectTimers()
      return
    }

    setConnectionMode('reconnecting')

    if (!pollingIntervalRef.current) {
      pollState()
      pollingIntervalRef.current = setInterval(pollState, 2000)
    }

    const backoffSec = Math.min(16, Math.max(2, Math.pow(2, Math.min(4, attempts))))
    setRetryCountdown(backoffSec)

    clearReconnectTimers()

    let remaining = backoffSec
    countdownIntervalRef.current = setInterval(() => {
      remaining--
      if (remaining <= 0) {
        clearReconnectTimers()
        connectWS()
      } else {
        setRetryCountdown(remaining)
      }
    }, 1000)
  }, [isMock, pollState, clearReconnectTimers, connectWS])

  // Start specific simulation scenario
  const startSimulationScenario = useCallback(
    (scenarioId: SimulationScenarioId, customTargetRate?: number, customTargetVol?: number) => {
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {}
        wsRef.current = null
      }
      stopPolling()
      clearReconnectTimers()

      setIsMock(true)
      setActiveScenario(scenarioId)
      setConnectionMode('live')
      setFailedAttempts(0)
      simTickCounterRef.current = 0
      currentSimIncidentRef.current = null

      if (simIntervalRef.current) clearInterval(simIntervalRef.current)

      // Initialize initial ticks if empty
      const initialNow = Math.floor(Date.now() / 1000)
      if (scenarioId === 'warmup') {
        setTicks([])
        setAlerts([])
        setActiveIncident(null)
        setStatus('WARMING_UP')
        setScenarioRemainingSec(60)
      } else {
        setStatus('NORMAL')
        setScenarioRemainingSec(scenarioId === 'blip' ? 20 : scenarioId === 'volume_drop' ? 30 : 45)
        // Seed 20 historical ticks so chart is immediately populated
        setTicks((prev) => {
          if (prev.length > 5) return prev
          const seed: Tick[] = []
          for (let i = 20; i >= 1; i--) {
            seed.push({
              ts: initialNow - i,
              rate: 0.019 + (Math.random() - 0.5) * 0.003,
              baseline: 0.02,
              z: 0.6,
              volume: 498,
              status: 'NORMAL',
              expected_variation: 0.006,
            })
          }
          return seed
        })
      }

      simIntervalRef.current = setInterval(() => {
        simTickCounterRef.current++
        const sec = simTickCounterRef.current
        const nowTs = Math.floor(Date.now() / 1000)
        setScenarioRemainingSec((prev) => Math.max(0, prev - 1))

        let rate = 0.02 + (Math.random() - 0.5) * 0.004
        let baseline = 0.02
        let volume = customTargetVol ?? 498
        let z = 0.7
        let curStatus: SystemStatus = 'NORMAL'

        if (scenarioId === 'warmup') {
          // Warmup scenario: 0 to 60s
          curStatus = 'WARMING_UP'
          setStatus('WARMING_UP')
          handleMessage({
            type: 'tick',
            ts: nowTs,
            rate: 0.02 + (Math.random() - 0.5) * 0.003,
            baseline: 0.02,
            z: 0.5,
            volume: 498,
            status: 'WARMING_UP',
            warmup_s: Math.min(60, sec),
          })
          return
        }

        if (scenarioId === 'parser_fail') {
          // Bad line ratio spikes to 34%
          setHealth((h) => ({
            ...h,
            bad_line_ratio: 0.34,
            tailer_lag_s: '0.08',
            last_tick_ts: nowTs,
          }))
          curStatus = 'DEGRADED'
          setStatus('DEGRADED')
        } else if (scenarioId === 'volume_drop') {
          // Volume plunge to 15 lines/s
          volume = Math.floor(12 + Math.random() * 6)
          rate = 0.02
          z = 0.4
          curStatus = 'NORMAL'
        } else if (scenarioId === 'blip') {
          // Five-second burst at 35%
          if (sec >= 4 && sec <= 9) {
            rate = 0.35 + (Math.random() - 0.5) * 0.03
            z = 7.4
            curStatus = 'ANOMALY'
            if (!currentSimIncidentRef.current) {
              const incId = `inc-${String(simIncidentCounterRef.current++).padStart(4, '0')}`
              currentSimIncidentRef.current = {
                incident_id: incId,
                alert_type: 'ERROR_RATE',
                state: 'OPEN',
                severity: 'HIGH',
                peak_severity: 'HIGH',
                error_rate: rate,
                baseline: 0.02,
                z: z,
                window_s: 30,
                volume: volume,
                top_errors: ['HTTP 504 Gateway Timeout (142)', 'Postgres upstream connection pool exhausted (84)'],
                opened_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                explanation: 'Short-window error rate reached 35.0% (z = 7.4), exceeding baseline + 2 pp.',
              }
              handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
            }
          } else if (sec > 9 && currentSimIncidentRef.current && currentSimIncidentRef.current.state !== 'RESOLVED') {
            currentSimIncidentRef.current.state = 'RESOLVED'
            currentSimIncidentRef.current.resolved_at = new Date().toISOString()
            handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
            currentSimIncidentRef.current = null
          }
        } else if (scenarioId === 'slow_ramp') {
          // Creeping ramp up to 12%
          const factor = Math.min(1, sec / 25)
          rate = 0.02 + 0.10 * factor + (Math.random() - 0.5) * 0.01
          z = Number((0.6 + 4.2 * factor).toFixed(1))
          if (z >= 3.0 && rate - baseline >= 0.02) {
            curStatus = 'ANOMALY'
            if (!currentSimIncidentRef.current) {
              const incId = `inc-${String(simIncidentCounterRef.current++).padStart(4, '0')}`
              currentSimIncidentRef.current = {
                incident_id: incId,
                alert_type: 'ERROR_RATE',
                state: 'OPEN',
                severity: 'MEDIUM',
                peak_severity: 'MEDIUM',
                error_rate: rate,
                baseline: 0.02,
                z: z,
                window_s: 30,
                volume: volume,
                top_errors: ['Redis cache replica desync (45)', 'Auth token validation timeout (22)'],
                opened_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
              handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
            }
          }
        } else if (scenarioId === 'step_25') {
          // Full incident lifecycle: Steady -> 25% High -> 50% Critical Escalation -> Recovery
          const cycleSec = sec % 40
          if (cycleSec < 8) {
            rate = 0.02 + (Math.random() - 0.5) * 0.004
            curStatus = 'NORMAL'
          } else if (cycleSec >= 8 && cycleSec < 22) {
            rate = customTargetRate ?? 0.245 + (Math.random() - 0.5) * 0.02
            volume = 510
            z = 6.2
            curStatus = 'ANOMALY'

            if (!currentSimIncidentRef.current || currentSimIncidentRef.current.state === 'RESOLVED') {
              const incId = `inc-${String(simIncidentCounterRef.current++).padStart(4, '0')}`
              currentSimIncidentRef.current = {
                incident_id: incId,
                alert_type: 'ERROR_RATE',
                state: 'OPEN',
                severity: 'HIGH',
                peak_severity: 'HIGH',
                error_rate: rate,
                baseline: 0.02,
                z: z,
                window_s: 30,
                volume: 510,
                top_errors: [
                  'DB connection pool timeout (242)',
                  'HTTP 504 Gateway Timeout (118)',
                  'Redis read replica timeout (36)',
                ],
                opened_at: new Date(Date.now() - 30000).toISOString(),
                updated_at: new Date().toISOString(),
                explanation: 'Error rate increased to 24.5%, baseline is 2.0% (z = 6.2 ≥ 3.0).',
              }
              handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
            }
          } else if (cycleSec >= 22 && cycleSec < 32) {
            rate = 0.48 + (Math.random() - 0.5) * 0.03
            volume = 560
            z = 9.8
            curStatus = 'ANOMALY'

            if (currentSimIncidentRef.current && currentSimIncidentRef.current.state === 'OPEN') {
              currentSimIncidentRef.current.state = 'ESCALATED'
              currentSimIncidentRef.current.severity = 'CRITICAL'
              currentSimIncidentRef.current.peak_severity = 'CRITICAL'
              currentSimIncidentRef.current.error_rate = rate
              currentSimIncidentRef.current.z = z
              currentSimIncidentRef.current.updated_at = new Date().toISOString()
              currentSimIncidentRef.current.top_errors = [
                'DB connection pool timeout (589)',
                'HTTP 504 Gateway Timeout (312)',
                'Worker thread pool exhausted (144)',
              ]
              handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
            }
          } else {
            // Recovery
            rate = 0.021 + (Math.random() - 0.5) * 0.003
            curStatus = 'NORMAL'
            if (currentSimIncidentRef.current && currentSimIncidentRef.current.state === 'ESCALATED') {
              currentSimIncidentRef.current.state = 'RESOLVED'
              currentSimIncidentRef.current.severity = 'HIGH'
              currentSimIncidentRef.current.peak_severity = 'CRITICAL'
              currentSimIncidentRef.current.error_rate = rate
              currentSimIncidentRef.current.z = 0.8
              currentSimIncidentRef.current.updated_at = new Date().toISOString()
              currentSimIncidentRef.current.resolved_at = new Date().toISOString()
              handleMessage({ type: 'alert', ...currentSimIncidentRef.current })
              currentSimIncidentRef.current = null
            }
          }
        }

        setStatus(curStatus)
        handleMessage({
          type: 'tick',
          ts: nowTs,
          rate: Math.max(0.005, rate),
          baseline: 0.02,
          z: z,
          volume: volume,
          status: curStatus,
          expected_variation: 0.005,
        })
      }, 1000)
    },
    [handleMessage, clearReconnectTimers, stopPolling]
  )

  const stopSimulation = useCallback(() => {
    setIsMock(false)
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current)
      simIntervalRef.current = null
    }
    setHealth((h) => ({
      ...h,
      bad_line_ratio: 0.0,
      tailer_lag_s: '0.04',
    }))
    connectWS()
  }, [connectWS])

  const toggleSimulator = useCallback(() => {
    if (isMock) {
      stopSimulation()
    } else {
      startSimulationScenario('step_25')
    }
  }, [isMock, stopSimulation, startSimulationScenario])

  // Connection retry handler
  const retryConnection = useCallback(() => {
    reconnectAttemptsRef.current = 0
    setFailedAttempts(0)
    clearReconnectTimers()
    connectWS()
  }, [clearReconnectTimers, connectWS])

  useEffect(() => {
    const handleFocus = () => {
      document.title = ORIGINAL_TITLE
    }
    window.addEventListener('focus', handleFocus)

    if (isMock) {
      startSimulationScenario(activeScenario)
    } else {
      connectWS()
    }

    return () => {
      window.removeEventListener('focus', handleFocus)
      stopPolling()
      clearReconnectTimers()
      if (simIntervalRef.current) clearInterval(simIntervalRef.current)
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {}
      }
    }
  }, [])

  // Derived operational states
  const currentTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined
  const dataAgeSec = currentTick ? Math.max(0, Math.floor(Date.now() / 1000 - currentTick.ts)) : 0
  const isStale = dataAgeSec > 10 || ((connectionMode === 'reconnecting' || connectionMode === 'offline') && ticks.length > 0)
  const isDisconnectedAndNoData =
    (connectionMode === 'reconnecting' || connectionMode === 'offline') && ticks.length === 0 && !isMock

  // Map to clear detector state hierarchy
  let detectorState: DetectorStateType = 'healthy'
  if (connectionMode === 'offline' || connectionMode === 'reconnecting') {
    detectorState = 'disconnected'
  } else if (activeIncident && (activeIncident.state === 'OPEN' || activeIncident.state === 'ESCALATED')) {
    detectorState = 'incident_open'
  } else if (health.bad_line_ratio && health.bad_line_ratio > 0.1) {
    detectorState = 'degraded'
  } else if (typeof health.tailer_lag_s === 'number' && health.tailer_lag_s > 10) {
    detectorState = 'data_delayed'
  } else if (status === 'WARMING_UP' || (currentTick && currentTick.warmup_s && currentTick.warmup_s < 60)) {
    detectorState = 'warming_up'
  } else {
    detectorState = 'healthy'
  }

  const lastUpdateStr = currentTick
    ? new Date(currentTick.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '--:--:--'

  return {
    ticks,
    alerts,
    activeIncident,
    status,
    detectorState,
    connectionMode,
    retryCountdown,
    failedAttempts,
    isStale,
    isDisconnectedAndNoData,
    health,
    isMock,
    activeScenario,
    scenarioRemainingSec,
    flashAlertId,
    lastUpdateStr,
    dataAgeSec,
    currentTick,
    toggleSimulator,
    startSimulationScenario,
    stopSimulation,
    retryConnection,
    acknowledgeIncident,
  }
}
