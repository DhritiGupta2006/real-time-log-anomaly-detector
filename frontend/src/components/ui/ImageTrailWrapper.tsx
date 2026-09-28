import { useState, useEffect } from "react"
import { ImageTrail } from "@/components/ui/image-trail"

const FALLBACK_TILE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='170'%3E%3Crect width='100%25' height='100%25' fill='%23171717'/%3E%3C/svg%3E"

interface ImageTrailWrapperProps {
  images: string[]
  imageWidth?: number
  imageHeight?: number
  threshold?: number
  duration?: number
}

export function ImageTrailWrapper({
  images,
  imageWidth = 260,
  imageHeight = 170,
  threshold = 70,
  duration = 1.4,
}: ImageTrailWrapperProps) {
  const [safeImages, setSafeImages] = useState<string[]>(() => [...images])

  useEffect(() => {
    // Validate each image in the array, falling back to #171717 tile if missing
    images.forEach((src, idx) => {
      const img = new window.Image()
      img.onerror = () => {
        setSafeImages((prev) => {
          const next = [...prev]
          next[idx] = FALLBACK_TILE
          return next
        })
      }
      img.src = src
    })
  }, [images])

  return (
    <ImageTrail
      images={safeImages}
      imageWidth={imageWidth}
      imageHeight={imageHeight}
      threshold={threshold}
      duration={duration}
    />
  )
}
