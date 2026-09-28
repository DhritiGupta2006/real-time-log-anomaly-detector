import { useState } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Alert, SimulationScenarioId } from '@/types/dashboard'
import { HeaderBar } from './HeaderBar'
import { StatusBanner } from './StatusBanner'
import { StatusStrip } from './StatusStrip'
import { PipelineHealthStrip } from './PipelineHealthStrip'
import { MetricsChart } from './MetricsChart'
import { AlertFeed } from './AlertFeed'
import { IncidentDrawer } from './IncidentDrawer'
import { SimulationModal } from './SimulationModal'

interface DashboardProps {
  onNavigateToIntro?: () => void
  onNavigateToInfo?: () => void
}

const SCENARIO_NAMES: Record<SimulationScenarioId, string> = {
  step_25: 'Step to 25%',
  slow_ramp: 'Slow Ramp 12%',
  blip: '5s Blip',
  volume_drop: 'Volume Drop',
  parser_fail: 'Parser Degraded',
  steady: 'Steady 2%',
  warmup: 'Warmup Reset',
}

export function Dashboard({ onNavigateToIntro, onNavigateToInfo }: DashboardProps) {
  const {
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
  } = useWebSocket()

  const [selectedIncident, setSelectedIncident] = useState<Alert | null>(null)
  const [isSimModalOpen, setIsSimModalOpen] = useState(false)

  const activeScenarioName = SCENARIO_NAMES[activeScenario] || activeScenario

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-6 pb-12 min-h-screen">
      {/* 1. Operational Header Bar */}
      <HeaderBar
        connectionMode={connectionMode}
        retryCountdown={retryCountdown}
        failedAttempts={failedAttempts}
        isDisconnectedAndNoData={isDisconnectedAndNoData}
        isMock={isMock}
        activeScenarioName={activeScenarioName}
        sourceFile={health.source_file || 'application.log'}
        lastUpdateStr={lastUpdateStr}
        dataAgeSec={dataAgeSec}
        onToggleSimulator={toggleSimulator}
        onOpenSimulationModal={() => setIsSimModalOpen(true)}
        onNavigateToIntro={onNavigateToIntro}
        onNavigateToInfo={onNavigateToInfo}
        onRetryConnection={retryConnection}
      />

      {/* 2. Top-Level Actionable Status Banner */}
      <StatusBanner
        detectorState={detectorState}
        connectionMode={connectionMode}
        activeIncident={activeIncident}
        lastUpdateStr={lastUpdateStr}
        linesPerSec={currentTick ? Math.round(currentTick.volume) : 498}
        warmupSec={currentTick?.warmup_s ?? 0}
        sourceFile={health.source_file || 'application.log'}
        badLineRatio={health.bad_line_ratio ?? 0}
        tailerLagSec={health.tailer_lag_s ?? '0.04'}
        onRetryConnection={retryConnection}
      />

      {/* Container dimmed to 60% opacity when data is stale (>10s) */}
      <div className={`flex flex-col gap-4 transition-opacity duration-300 ${isStale ? 'opacity-65' : 'opacity-100'}`}>
        {/* 3. Improved Metric Cards (4 cards with sparklines & effect size) */}
        <StatusStrip
          currentTick={currentTick}
          ticks={ticks}
          activeIncident={activeIncident}
          systemStatus={status}
          detectorState={detectorState}
          dataAgeSec={dataAgeSec}
          isStale={isStale}
        />

        {/* 4. Dedicated Pipeline Health Strip */}
        <PipelineHealthStrip
          health={health}
          lastTickTs={currentTick?.ts}
          isStale={isStale}
          sourceFile={health.source_file || 'application.log'}
        />

        {/* 5. Metrics Chart (with shaded baseline band, thresholds, time ranges, and markers) */}
        <MetricsChart
          ticks={ticks}
          activeIncident={activeIncident}
          alerts={alerts}
          detectorState={detectorState}
          isDisconnectedAndNoData={isDisconnectedAndNoData}
          lastUpdateStr={lastUpdateStr}
          dataAgeSec={dataAgeSec}
        />

        {/* 6. Dominant Incident Feed with Active Callouts */}
        <AlertFeed
          alerts={alerts}
          flashAlertId={flashAlertId}
          systemStatus={status}
          onSelectAlert={(a) => setSelectedIncident(a)}
          onAcknowledgeAlert={acknowledgeIncident}
        />
      </div>

      {/* 7. Incident Detail Drawer (opened on alert click) */}
      <IncidentDrawer
        alert={selectedIncident}
        onClose={() => setSelectedIncident(null)}
        onAcknowledge={acknowledgeIncident}
      />

      {/* 8. Simulation Preset Modal */}
      <SimulationModal
        isOpen={isSimModalOpen}
        isMock={isMock}
        currentScenario={activeScenario}
        activeScenarioName={activeScenarioName}
        remainingSeconds={scenarioRemainingSec}
        onClose={() => setIsSimModalOpen(false)}
        onStartScenario={(sc, rate, vol) => startSimulationScenario(sc, rate, vol)}
        onStopSimulation={stopSimulation}
      />
    </div>
  )
}
