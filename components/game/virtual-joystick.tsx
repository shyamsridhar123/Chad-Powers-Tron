"use client"

import type React from "react"
import { useRef, useCallback, useEffect, useState } from "react"

interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void
}

export function VirtualJoystick({ onMove }: VirtualJoystickProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [stickPosition, setStickPosition] = useState({ x: 0, y: 0 })
  const centerRef = useRef({ x: 0, y: 0 })
  const maxDistance = 40 // Increased from 35 to 40 for larger joystick

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      centerRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
      setIsDragging(true)

      const deltaX = clientX - centerRef.current.x
      const deltaY = clientY - centerRef.current.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const clampedDistance = Math.min(distance, maxDistance)
      const angle = Math.atan2(deltaY, deltaX)

      const x = Math.cos(angle) * clampedDistance
      const y = Math.sin(angle) * clampedDistance

      setStickPosition({ x, y })
      onMove(x / maxDistance, y / maxDistance)
    },
    [onMove],
  )

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return

      const deltaX = clientX - centerRef.current.x
      const deltaY = clientY - centerRef.current.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const clampedDistance = Math.min(distance, maxDistance)
      const angle = Math.atan2(deltaY, deltaX)

      const x = Math.cos(angle) * clampedDistance
      const y = Math.sin(angle) * clampedDistance

      setStickPosition({ x, y })
      onMove(x / maxDistance, y / maxDistance)
    },
    [isDragging, onMove],
  )

  const handleEnd = useCallback(() => {
    setIsDragging(false)
    setStickPosition({ x: 0, y: 0 })
    onMove(0, 0)
  }, [onMove])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Attempt to prevent default scroll behavior
      // Note: May be ignored in passive event listeners
      e.preventDefault()
      const touch = e.touches[0]
      handleStart(touch.clientX, touch.clientY)
    },
    [handleStart],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0]
      handleMove(touch.clientX, touch.clientY)
    },
    [handleMove],
  )

  useEffect(() => {
    const handleGlobalMove = (e: TouchEvent | MouseEvent) => {
      if (!isDragging) return

      if (e instanceof TouchEvent) {
        const touch = e.touches[0]
        if (touch) handleMove(touch.clientX, touch.clientY)
      } else {
        handleMove(e.clientX, e.clientY)
      }
    }

    const handleGlobalEnd = () => {
      handleEnd()
    }

    window.addEventListener("touchmove", handleGlobalMove, { passive: false })
    window.addEventListener("touchend", handleGlobalEnd)
    window.addEventListener("mousemove", handleGlobalMove)
    window.addEventListener("mouseup", handleGlobalEnd)

    return () => {
      window.removeEventListener("touchmove", handleGlobalMove)
      window.removeEventListener("touchend", handleGlobalEnd)
      window.removeEventListener("mousemove", handleGlobalMove)
      window.removeEventListener("mouseup", handleGlobalEnd)
    }
  }, [isDragging, handleMove, handleEnd])

  return (
    <div className="absolute bottom-8 left-6 z-50 pb-safe">
      {/* Joystick container - IMPROVED: Larger size for mobile (28 -> 32) */}
      <div
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
        className="relative w-32 h-32 rounded-full bg-black/50 backdrop-blur-sm border-2 border-cyan-500/50 flex items-center justify-center cursor-pointer select-none"
        style={{
          boxShadow: isDragging
            ? "0 0 30px rgba(0, 255, 255, 0.6), inset 0 0 25px rgba(0, 255, 255, 0.2)"
            : "0 0 20px rgba(0, 255, 255, 0.3), inset 0 0 15px rgba(0, 255, 255, 0.1)",
        }}
      >
        {/* Inner ring */}
        <div className="absolute inset-4 rounded-full border border-cyan-500/30" />

        {/* Direction indicators */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 text-cyan-500/50 text-xs font-bold">▲</div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-cyan-500/50 text-xs font-bold">▼</div>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500/50 text-xs font-bold">◀</div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-500/50 text-xs font-bold">▶</div>

        {/* Joystick knob - IMPROVED: Larger knob for better mobile visibility */}
        <div
          className="absolute w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400 to-cyan-600 border-2 border-cyan-300"
          style={{
            transform: `translate(${stickPosition.x}px, ${stickPosition.y}px)`,
            boxShadow: isDragging
              ? "0 0 25px rgba(0, 255, 255, 1), 0 4px 15px rgba(0, 0, 0, 0.5)"
              : "0 0 15px rgba(0, 255, 255, 0.7), 0 2px 8px rgba(0, 0, 0, 0.4)",
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        />
      </div>

      {/* Label */}
      <div className="text-center mt-2 text-xs text-cyan-400/80 font-bold uppercase tracking-wider">Move QB</div>
    </div>
  )
}
