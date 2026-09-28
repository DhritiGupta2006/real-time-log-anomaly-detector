"use client"
import { useRef, useState, useEffect, useCallback } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { ScrollSplitCard } from "@/components/ui/scroll-split-card"
import { ImageTrailWrapper } from "@/components/ui/ImageTrailWrapper"
import { ArrowRight, ExternalLink, BookOpen, Activity, Layers, BellRing } from "lucide-react"

interface PipelineIntroProps {
  onOpen?: () => void
  onOpenInfo?: () => void
}

const trailImages = [
  "/shots/trail-1.jpg",
  "/shots/trail-2.jpg",
  "/shots/trail-3.jpg",
  "/shots/trail-4.jpg",
  "/shots/trail-5.jpg",
  "/shots/trail-6.jpg",
]

const contentContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  },
}

export function PipelineIntro({ onOpen, onOpenInfo }: PipelineIntroProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardsWrapperRef = useRef<HTMLDivElement>(null)
  const trailSectionRef = useRef<HTMLElement>(null)
  const unmountTimerRef = useRef<number | null>(null)
  const hasSeededRef = useRef(false)
  const seedTimersRef = useRef<number[]>([])

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [shouldRenderTrail, setShouldRenderTrail] = useState(false)
  const [isTrailVisible, setIsTrailVisible] = useState(false)

  // Track reduced motion preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mediaQuery.matches)

    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [])

  // Fade cards out as trail approaches: opacity 1 -> 0.2
  const { scrollYProgress: cardsScrollProgress } = useScroll({
    container: containerRef,
    target: cardsWrapperRef,
    offset: ["end 90%", "end 40%"],
  })
  const cardsOpacity = useTransform(cardsScrollProgress, [0, 1], [1, 0.2])

  // Stop synthetic seeding when real mouse moves
  const stopSeeding = useCallback(() => {
    seedTimersRef.current.forEach((t) => window.clearTimeout(t))
    seedTimersRef.current = []
  }, [])

  useEffect(() => {
    const handleRealMouseMove = (e: MouseEvent) => {
      if (e.isTrusted) {
        stopSeeding()
      }
    }

    window.addEventListener("mousemove", handleRealMouseMove, { capture: true })
    return () => {
      window.removeEventListener("mousemove", handleRealMouseMove, { capture: true })
      stopSeeding()
    }
  }, [stopSeeding])

  // IntersectionObserver to mount ImageTrail at 50% visibility
  useEffect(() => {
    const section = trailSectionRef.current
    const root = containerRef.current
    if (!section) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting
        if (visible) {
          if (unmountTimerRef.current) {
            window.clearTimeout(unmountTimerRef.current)
            unmountTimerRef.current = null
          }
          setShouldRenderTrail(true)
          requestAnimationFrame(() => {
            setIsTrailVisible(true)
          })
        } else {
          setIsTrailVisible(false)
          if (unmountTimerRef.current) {
            window.clearTimeout(unmountTimerRef.current)
          }
          unmountTimerRef.current = window.setTimeout(() => {
            setShouldRenderTrail(false)
          }, 500)
        }
      },
      {
        root: root || null,
        threshold: 0.5,
      }
    )

    observer.observe(section)
    return () => {
      observer.disconnect()
      if (unmountTimerRef.current) {
        window.clearTimeout(unmountTimerRef.current)
      }
    }
  }, [])

  // Seed trail on first activation along an S-curve across the section
  useEffect(() => {
    if (!isTrailVisible || hasSeededRef.current || prefersReducedMotion) return

    const canHover = typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches
    if (!canHover) return

    hasSeededRef.current = true
    const section = trailSectionRef.current
    if (!section) return

    const numPoints = 8
    const durationMs = 900

    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1)
      const delay = t * durationMs

      const timer = window.setTimeout(() => {
        if (!trailSectionRef.current) return
        const currentRect = trailSectionRef.current.getBoundingClientRect()
        const x = currentRect.left + currentRect.width * (0.2 + 0.6 * t)
        const y = currentRect.top + currentRect.height * 0.5 + Math.sin(t * Math.PI * 2) * 110

        window.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          })
        )
      }, delay)

      seedTimersRef.current.push(timer)
    }
  }, [isTrailVisible, prefersReducedMotion])

  return (
    <div
      ref={containerRef}
      style={{
        scrollSnapType: prefersReducedMotion ? "none" : "y proximity",
      }}
      className="relative h-[100dvh] w-full overflow-y-auto overscroll-contain bg-[#0a0a0a] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {/* Floating Header Actions with Grey Dashed More Info Button */}
      <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5 sm:gap-3">
        {onOpen && (
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-[8px] border border-[#262626] bg-[#ededed] px-3.5 sm:px-4 py-2 text-xs font-semibold text-[#0a0a0a] transition-colors hover:bg-[#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ededed] cursor-pointer"
          >
            <span>Open dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {onOpenInfo && (
          <button
            onClick={onOpenInfo}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-[#5c5c5c] bg-[#111111]/90 backdrop-blur-sm px-3.5 py-2 text-xs font-medium text-[#ededed] transition-colors hover:border-[#ededed] hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ededed] cursor-pointer"
            title="Read system architecture and statistical detector methodology"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#8a8a8a]" />
            <span>More Info</span>
          </button>
        )}

        <a
          href="/static/index.html"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-[8px] border border-[#262626] bg-[#111111] px-3 py-2 text-xs font-mono text-[#8a8a8a] transition-colors hover:bg-[#171717] hover:text-[#ededed]"
          title="Open static single-file HTML build"
        >
          <span>Single-File HTML</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Section 1: ScrollSplitCard with hero image split into three boxes */}
      <motion.div
        ref={cardsWrapperRef}
        style={{
          opacity: prefersReducedMotion ? 1 : cardsOpacity,
        }}
        className="w-full"
      >
        <ScrollSplitCard
          containerRef={containerRef}
          imageSrc="/shots/hero.jpg"
          className="h-[175vh]"
          cards={[
            {
              title: "Detect",
              description:
                "Tails the log, builds a rolling error rate, and flags deviations from a learned baseline with a two-proportion z-test.",
              bgColor: "#111111",
              textColor: "#ededed",
              icon: <Activity className="w-4 h-4 text-emerald-400" />,
            },
            {
              title: "Escalate",
              description:
                "Grades severity from LOW to CRITICAL and tracks each incident from OPEN to ESCALATED to RESOLVED.",
              bgColor: "#141414",
              textColor: "#ededed",
              icon: <Layers className="w-4 h-4 text-amber-400" />,
            },
            {
              title: "Notify",
              description:
                "Pushes every transition to the live feed over WebSocket and to AWS CloudWatch Logs or SNS.",
              bgColor: "#0a0a0a",
              textColor: "#ededed",
              icon: <BellRing className="w-4 h-4 text-rose-400" />,
            },
          ]}
        />
      </motion.div>

      {/* Section 2: ImageTrail Hero Section with 1px hairline gradient & scroll snap */}
      <section
        ref={trailSectionRef}
        style={{
          scrollSnapAlign: prefersReducedMotion ? "none" : "start",
        }}
        className="relative -mt-[170px] h-[100dvh] w-full overflow-hidden bg-[#0a0a0a]"
      >
        {/* Grayscale hairline handoff */}
        <div
          className="absolute top-0 left-0 right-0 z-20 h-[1px] pointer-events-none"
          style={{
            background: "linear-gradient(90deg, transparent, #262626, transparent)",
          }}
        />

        {/* Trail container with 500ms opacity transition */}
        <div
          className={`absolute inset-0 transition-opacity duration-500 ${
            isTrailVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {shouldRenderTrail && !prefersReducedMotion && (
            <ImageTrailWrapper
              images={trailImages}
              imageWidth={260}
              imageHeight={170}
              threshold={70}
              duration={1.4}
            />
          )}
        </div>

        {/* Trail Content with staggered fade-up while in view */}
        <motion.div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 pointer-events-none px-4"
          variants={prefersReducedMotion ? undefined : contentContainerVariants}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "visible"}
          viewport={{ root: containerRef, amount: 0.4, once: true }}
        >
          <motion.h1
            variants={prefersReducedMotion ? undefined : itemVariants}
            className="text-4xl sm:text-5xl font-semibold tracking-tight text-[#ededed] text-center"
          >
            Log Anomaly Detector
          </motion.h1>
          <motion.p
            variants={prefersReducedMotion ? undefined : itemVariants}
            className="max-w-md text-center text-sm text-[#8a8a8a] leading-relaxed"
          >
            Real-time error-rate monitoring with learned baselines, severity grading, and automated AWS dispatch.
          </motion.p>
          <motion.div
            variants={prefersReducedMotion ? undefined : itemVariants}
            className="flex flex-wrap items-center justify-center gap-3 pointer-events-auto"
          >
            {onOpen && (
              <button
                onClick={onOpen}
                className="rounded-[8px] bg-[#ededed] px-5 py-2 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-[#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ededed] cursor-pointer"
              >
                Open dashboard
              </button>
            )}
            {onOpenInfo && (
              <button
                onClick={onOpenInfo}
                className="inline-flex items-center gap-2 rounded-[8px] border border-dashed border-[#5c5c5c] bg-[#111111]/80 px-4 py-2 text-sm font-medium text-[#ededed] transition-colors hover:border-[#ededed] hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ededed] cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-[#8a8a8a]" />
                <span>More Info</span>
              </button>
            )}
          </motion.div>
        </motion.div>
      </section>
    </div>
  )
}
