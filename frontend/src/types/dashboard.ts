export type SystemStatus = 'NORMAL' | 'ANOMALY' | 'WARMING_UP' | 'DEGRADED' | 'DATA_DELAYED'

export type IncidentState = 'OPEN' | 'ESCALATED' | 'RESOLVED'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type DetectorStateType =
  | 'healthy'
  | 'warming_up'
  | 'degraded'
  | 'data_delayed'
  | 'incident_open'
  | 'disconnected'

export interface IncidentTransition {
  timestamp: string
  fromState?: string
  toState: string
  severity: Severity
  message: string
}

export interface Tick {
  ts: number
  rate: number
  baseline: number
  z: number
  volume: number
  status: SystemStatus
  warmup_s?: number
  expected_variation?: number
}

export interface Alert {
  incident_id: string
  type_?: string
  alert_type?: string
  state: IncidentState
  severity: Severity
  peak_severity?: Severity
  error_rate: number
  baseline: number
  z: number
  window_s: number
  volume?: number
  top_errors: string[]
  opened_at: string
  updated_at: string
  resolved_at?: string
  acknowledged?: boolean
  explanation?: string
  transitions?: IncidentTransition[]
}

export interface HealthState {
  tailer_lag_s?: string | number
  bad_line_ratio?: number
  last_tick_ts?: number
  queue_depth?: number
  bytes_processed_mb?: number
  source_file?: string
  lines_per_sec?: number
  parser_errors_total?: number
}

export type ConnectionMode = 'live' | 'polling' | 'reconnecting' | 'offline'

export type SimulationScenarioId =
  | 'steady'
  | 'step_25'
  | 'blip'
  | 'slow_ramp'
  | 'volume_drop'
  | 'parser_fail'
  | 'warmup'

export interface SimulationScenario {
  id: SimulationScenarioId
  name: string
  description: string
  targetRate: number
  targetVolume: number
  durationSeconds: number
}
