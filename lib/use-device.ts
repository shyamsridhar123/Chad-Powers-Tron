"use client"

import { useState, useEffect } from "react"

/**
 * Hook to detect if the user is on a desktop device.
 * Returns true for devices with a fine pointer (mouse) and no touch support.
 * Returns false for mobile/tablet devices or hybrid devices with touch.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    // Check for fine pointer (mouse) and absence of touch
    const hasFinePonter = window.matchMedia("(pointer: fine)").matches
    const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0

    // Consider it desktop only if it has a fine pointer AND no touch
    // This ensures hybrid devices (touch laptops) still get mobile controls
    setIsDesktop(hasFinePonter && !hasTouch)
  }, [])

  return isDesktop
}
