import { useEffect, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
} from 'chart.js'

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip
)

interface SevenDayTrendlineProps {
  data?: number[]
  incidentCount?: number
}

const DEFAULT_7D_DATA = [1, 2, 1, 3, 2, 2, 1] // Sum = 12 incidents over 7 days

export function SevenDayTrendline({
  data = DEFAULT_7D_DATA,
  incidentCount = 12,
}: SevenDayTrendlineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartInstanceRef = useRef<ChartJS | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  })

  // Listen to prefers-reduced-motion system setting
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy()
      chartInstanceRef.current = null
    }

    const chart = new ChartJS(ctx, {
      type: 'line',
      data: {
        labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Today'],
        datasets: [
          {
            data,
            borderColor: '#8a8a8a',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: prefersReducedMotion ? 2.5 : 3.5,
            pointHitRadius: 8,
            pointBackgroundColor: '#ededed',
            pointBorderColor: '#ededed',
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#ededed',
            pointHoverBorderWidth: 1,
            tension: 0.35,
            fill: false,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        transitions: {
          active: {
            animation: {
              duration: prefersReducedMotion ? 0 : 200,
              easing: 'easeOutQuad',
            },
          },
          hover: {
            animation: {
              duration: prefersReducedMotion ? 0 : 200,
              easing: 'easeOutQuad',
            },
          },
        },
        events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'],
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            display: false,
          },
          y: {
            display: false,
            min: 0,
            suggestedMax: Math.max(...data) + 1,
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            backgroundColor: '#171717',
            borderColor: '#262626',
            borderWidth: 1,
            titleColor: '#8a8a8a',
            bodyColor: '#ededed',
            titleFont: { size: 10, family: '"IBM Plex Mono", monospace' },
            bodyFont: { size: 11, family: '"IBM Plex Mono", monospace' },
            padding: 6,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label || '',
              label: (item) => `${item.parsed.y} inc`,
            },
          },
        },
      },
    })

    chartInstanceRef.current = chart

    return () => {
      chart.destroy()
      chartInstanceRef.current = null
    }
  }, [data, prefersReducedMotion])

  return (
    <div
      className="inline-flex items-center gap-2 rounded-[8px] border border-[#262626] bg-[#0a0a0a] px-2.5 py-1 text-xs transition-colors hover:border-[#5c5c5c]"
      title="7-day incident count trendline"
    >
      <span className="text-[11px] font-medium text-[#8a8a8a]">7d trend</span>
      <div className="flex h-[20px] w-[56px] items-center justify-center">
        <canvas
          ref={canvasRef}
          width={56}
          height={20}
          className="block cursor-crosshair motion-reduce:transition-none"
          style={{ width: '56px', height: '20px', display: 'block' }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[#ededed]">
        {incidentCount} inc
      </span>
    </div>
  )
}
