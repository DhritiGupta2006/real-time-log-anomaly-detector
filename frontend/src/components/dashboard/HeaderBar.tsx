import { useState } from 'react'
import { ConnectionMode, SimulationScenarioId } from '@/types/dashboard'
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Zap,
  ExternalLink,
  Sliders,
  CheckCircle2,
  WifiOff,
  Loader2,
  FileText,
  Clock,
} from 'lucide-react'

interface HeaderBarProps {
  connectionMode: ConnectionMode
  retryCountdown: number
  failedAttempts: number
  isDisconnectedAndNoData: boolean
  isMock: boolean
  activeScenarioName: string
  sourceFile?: string
  lastUpdateStr: string
  dataAgeSec: number
  onToggleSimulator: () => void
  onOpenSimulationModal: () => void
  onNavigateToIntro?: () => void
  onNavigateToInfo?: () => void
  onRetryConnection?: () => void
}

export function HeaderBar({
  connectionMode,
  retryCountdown,
  isDisconnectedAndNoData,
  isMock,
  activeScenarioName,
  sourceFile = 'application.log',
  lastUpdateStr,
  dataAgeSec,
  onToggleSimulator,
  onOpenSimulationModal,
  onNavigateToIntro,
  onNavigateToInfo,
  onRetryConnection,
}: HeaderBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#262626] bg-[#111111] p-4">
      {/* Left zone: Navigation & Brand */}
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        {onNavigateToIntro && (
          <button
            onClick={onNavigateToIntro}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 text-xs text-[#8a8a8a] transition-colors hover:border-[#5c5c5c] hover:text-[#ededed] cursor-pointer"
            title="Return to Pipeline Architecture Intro"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Intro</span>
          </button>
        )}

        {onNavigateToInfo && (
          <button
            onClick={onNavigateToInfo}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 text-xs text-[#8a8a8a] transition-colors hover:border-[#5c5c5c] hover:text-[#ededed] cursor-pointer"
            title="Read system architecture & statistical derivation"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">More Info</span>
          </button>
        )}

        <div className="h-4 w-[1px] bg-[#262626] hidden sm:block" />

        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-[#ededed] shrink-0" />
          <div className="flex flex-col">
            <h1 className="text-sm sm:text-base font-semibold tracking-tight text-[#ededed] leading-none">
              Log Anomaly Detector
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8a8a8a] mt-1">
              <span>Source:</span>
              <span className="text-[#ededed] font-medium">{sourceFile}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right zone: Connection, Simulation Selector, Static build */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Connection status pill */}
        <div
          className="inline-flex items-center gap-2 rounded-full border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 text-xs font-medium text-[#8a8a8a]"
          role="status"
          aria-live="polite"
        >
          {connectionMode === 'live' && (
            <>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-[#ededed] font-medium">Connected</span>
              <span className="text-[#5c5c5c]">·</span>
              <span className="font-mono text-[11px]">
                {dataAgeSec <= 2 ? '1.2s ago' : `${dataAgeSec}s ago`}
              </span>
            </>
          )}

          {connectionMode === 'polling' && (
            <>
              <span className="h-2 w-2 rounded-full border border-[#ededed] bg-transparent" />
              <span className="text-[#ededed] font-medium">Polling</span>
            </>
          )}

          {connectionMode === 'reconnecting' && (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-400 motion-safe:animate-pulse" />
              <span className="text-amber-200 font-mono text-[11px]">
                Reconnecting in {retryCountdown}s
              </span>
              {onRetryConnection && (
                <button
                  onClick={onRetryConnection}
                  className="underline text-[10px] text-amber-300 hover:text-white ml-1 cursor-pointer"
                >
                  Retry
                </button>
              )}
            </>
          )}

          {connectionMode === 'offline' && (
            <>
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-rose-300 font-mono text-[11px]">Offline</span>
              {onRetryConnection && (
                <button
                  onClick={onRetryConnection}
                  className="underline text-[10px] text-[#ededed] hover:text-white ml-1 cursor-pointer"
                >
                  Reconnect
                </button>
              )}
            </>
          )}
        </div>

        {/* Simulation Scenario Trigger Button */}
        <div className="flex items-center">
          <button
            onClick={onOpenSimulationModal}
            className={`inline-flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-xs font-mono transition-all cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ededed] ${
              isMock
                ? 'border-cyan-500/70 bg-cyan-950/40 text-cyan-200 shadow-sm'
                : 'border-[#262626] bg-[#0a0a0a] text-[#8a8a8a] hover:border-[#5c5c5c] hover:text-[#ededed]'
            }`}
            title="Configure simulation presets or inject chaos telemetry"
          >
            <Zap className={`w-3.5 h-3.5 ${isMock ? 'text-cyan-400 fill-current' : 'text-[#8a8a8a]'}`} />
            <span>Simulation: {isMock ? activeScenarioName : 'Off'}</span>
            <Sliders className="w-3 h-3 text-[#5c5c5c] ml-0.5" />
          </button>
        </div>

        {/* Single-file build link */}
        <a
          href="/static/index.html"
          target="_blank"
          rel="noreferrer"
          className="hidden md:inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 text-xs font-mono text-[#8a8a8a] transition-colors hover:border-[#5c5c5c] hover:text-[#ededed]"
          title="Open pure single-file standalone HTML version"
        >
          <span>Single-File HTML</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </header>
  )
}
