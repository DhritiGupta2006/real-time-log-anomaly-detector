import { useState } from 'react'
import { SimulationScenarioId, SimulationScenario } from '@/types/dashboard'
import {
  X,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
  TrendingDown,
  AlertTriangle,
  Flame,
  CheckCircle,
} from 'lucide-react'

interface SimulationModalProps {
  isOpen: boolean
  isMock: boolean
  currentScenario: SimulationScenarioId
  activeScenarioName: string
  remainingSeconds: number
  onClose: () => void
  onStartScenario: (scenario: SimulationScenarioId, customRate?: number, customVol?: number) => void
  onStopSimulation: () => void
}

const PRESET_SCENARIOS: SimulationScenario[] = [
  {
    id: 'step_25',
    name: 'Step to 25% Incident',
    description: 'Immediate jump to 25% error rate. Demonstrates instant OPEN high alert and automatic AWS escalation.',
    targetRate: 0.25,
    targetVolume: 120,
    durationSeconds: 45,
  },
  {
    id: 'slow_ramp',
    name: 'Slow Ramp to 12%',
    description: 'Gradual creeping error rate drift. Demonstrates z-score accumulation over successive rolling windows.',
    targetRate: 0.12,
    targetVolume: 80,
    durationSeconds: 60,
  },
  {
    id: 'blip',
    name: 'Five-Second Blip',
    description: 'Brief 35% error rate burst lasting 5 seconds, followed by quick recovery to verify cooldown hysteresis.',
    targetRate: 0.35,
    targetVolume: 150,
    durationSeconds: 20,
  },
  {
    id: 'volume_drop',
    name: 'Traffic Volume Drop',
    description: 'Sudden 80% traffic plunge down to 15 lines/s to trigger VOLUME_DROP detection.',
    targetRate: 0.02,
    targetVolume: 15,
    durationSeconds: 30,
  },
  {
    id: 'parser_fail',
    name: 'Parser Failure / Degraded',
    description: 'Spike bad line ratio to 34% unparseable entries, triggering PIPELINE DEGRADED state.',
    targetRate: 0.02,
    targetVolume: 50,
    durationSeconds: 30,
  },
  {
    id: 'steady',
    name: 'Steady Normal Baseline',
    description: 'Stable ~2.0% error rate with minor stochastic variation (±0.4 pp) within nominal baseline bounds.',
    targetRate: 0.02,
    targetVolume: 50,
    durationSeconds: 60,
  },
  {
    id: 'warmup',
    name: 'Cold Start / Warmup Phase',
    description: 'Resets the engine to t=0 learning baseline for 60 seconds with active progress indicators.',
    targetRate: 0.02,
    targetVolume: 50,
    durationSeconds: 60,
  },
]

export function SimulationModal({
  isOpen,
  isMock,
  currentScenario,
  activeScenarioName,
  remainingSeconds,
  onClose,
  onStartScenario,
  onStopSimulation,
}: SimulationModalProps) {
  const [selectedId, setSelectedId] = useState<SimulationScenarioId>(currentScenario)
  const [customRate, setCustomRate] = useState<number>(0.25)
  const [customVol, setCustomVol] = useState<number>(120)

  if (!isOpen) return null

  const handleLaunch = () => {
    onStartScenario(selectedId, customRate, customVol)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Telemetry Simulation Controls"
    >
      <div
        className="relative flex w-full max-w-xl flex-col rounded-[8px] border border-[#262626] bg-[#111111] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262626] pb-4">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#ededed]" />
              <h2 className="text-sm font-semibold tracking-tight text-[#ededed]">
                Telemetry Simulator &amp; Chaos Injector
              </h2>
            </div>
            <p className="text-xs text-[#8a8a8a]">
              Inject deterministic test patterns into the detection engine to evaluate state machine transitions.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#8a8a8a] hover:bg-[#171717] hover:text-[#ededed] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Current Status Banner */}
        <div className="my-4 flex items-center justify-between rounded-[8px] border border-[#262626] bg-[#0a0a0a] p-3 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span
              className={`h-2 w-2 rounded-full ${
                isMock ? 'bg-cyan-400 motion-safe:animate-pulse' : 'bg-[#5c5c5c]'
              }`}
            />
            <span className="text-[#8a8a8a]">Status:</span>
            <span className="font-semibold text-[#ededed]">
              {isMock ? `Active (${activeScenarioName})` : 'Offline / Live Tailer'}
            </span>
          </div>

          {isMock ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#8a8a8a]">
                {remainingSeconds}s remaining
              </span>
              <button
                onClick={onStopSimulation}
                className="rounded-[6px] border border-rose-900 bg-rose-950/40 px-2.5 py-1 font-mono text-[11px] text-rose-300 hover:bg-rose-900/60 cursor-pointer"
              >
                Stop
              </button>
            </div>
          ) : (
            <span className="font-mono text-[11px] text-[#8a8a8a]">Ready to inject</span>
          )}
        </div>

        {/* Preset Scenarios List */}
        <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
          <div className="text-[10px] uppercase font-mono tracking-wider text-[#8a8a8a]">
            PRESET SCENARIOS
          </div>
          {PRESET_SCENARIOS.map((sc) => {
            const isSelected = selectedId === sc.id
            return (
              <div
                key={sc.id}
                onClick={() => {
                  setSelectedId(sc.id)
                  setCustomRate(sc.targetRate)
                  setCustomVol(sc.targetVolume)
                }}
                className={`flex flex-col gap-1 rounded-[8px] border p-3 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-[#ededed] bg-[#171717]'
                    : 'border-[#262626] bg-[#0a0a0a] hover:border-[#5c5c5c]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#ededed]">{sc.name}</span>
                  <div className="flex items-center gap-2 font-mono text-[10px] text-[#8a8a8a]">
                    <span>{(sc.targetRate * 100).toFixed(0)}% rate</span>
                    <span>·</span>
                    <span>{sc.targetVolume} lines/s</span>
                  </div>
                </div>
                <p className="text-[11px] text-[#8a8a8a]">{sc.description}</p>
              </div>
            )
          })}
        </div>

        {/* Controls Footer */}
        <div className="mt-5 pt-4 border-t border-[#262626] flex items-center justify-between gap-3">
          <button
            onClick={() => {
              setSelectedId('steady')
              setCustomRate(0.02)
              setCustomVol(50)
            }}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-[#8a8a8a] hover:text-[#ededed] cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 text-xs text-[#8a8a8a] hover:text-[#ededed] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleLaunch}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#ededed] px-4 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-[#ffffff] cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Launch Scenario</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
