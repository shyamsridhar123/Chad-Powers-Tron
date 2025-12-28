"use client"

import { useEffect, useRef, useCallback, useState } from "react"

export function useAudioManager(isPlaying: boolean) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const isPlayingRef = useRef(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const hasInitializedRef = useRef(false)

  const initAudio = useCallback(() => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume()
      }
      return audioContextRef.current
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return null

    const ctx = new AudioContextClass()
    audioContextRef.current = ctx

    const gainNode = ctx.createGain()
    gainNode.gain.value = 0.2
    gainNode.connect(ctx.destination)
    gainNodeRef.current = gainNode

    hasInitializedRef.current = true
    console.log("[v0] Audio initialized")
    return ctx
  }, [])

  const ensureAudioReady = useCallback(() => {
    const ctx = initAudio()
    if (ctx && ctx.state === "suspended") {
      ctx.resume()
    }
  }, [initAudio])

  const playNote = useCallback(
    (frequency: number, duration: number, type: OscillatorType = "square", delay = 0) => {
      const ctx = audioContextRef.current
      const gainNode = gainNodeRef.current
      if (!ctx || !gainNode || isMuted) return

      const osc = ctx.createOscillator()
      const noteGain = ctx.createGain()

      osc.type = type
      osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay)

      noteGain.gain.setValueAtTime(0, ctx.currentTime + delay)
      noteGain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02)
      noteGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + duration)

      osc.connect(noteGain)
      noteGain.connect(gainNode)

      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + duration)
    },
    [isMuted],
  )

  const playKick = useCallback(() => {
    const ctx = audioContextRef.current
    const gainNode = gainNodeRef.current
    if (!ctx || !gainNode || isMuted) return

    const osc = ctx.createOscillator()
    const kickGain = ctx.createGain()

    osc.type = "sine"
    osc.frequency.setValueAtTime(150, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.15)

    kickGain.gain.setValueAtTime(0.6, ctx.currentTime)
    kickGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)

    osc.connect(kickGain)
    kickGain.connect(gainNode)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
  }, [isMuted])

  const playHiHat = useCallback(() => {
    const ctx = audioContextRef.current
    const gainNode = gainNodeRef.current
    if (!ctx || !gainNode || isMuted) return

    const bufferSize = ctx.sampleRate * 0.05
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = "highpass"
    filter.frequency.value = 7000

    const hihatGain = ctx.createGain()
    hihatGain.gain.setValueAtTime(0.15, ctx.currentTime)
    hihatGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05)

    noise.connect(filter)
    filter.connect(hihatGain)
    hihatGain.connect(gainNode)

    noise.start(ctx.currentTime)
    noise.stop(ctx.currentTime + 0.05)
  }, [isMuted])

  const playBassline = useCallback(
    (step: number) => {
      const bassNotes = [55, 55, 73.42, 55, 82.41, 55, 73.42, 61.74]
      const note = bassNotes[step % bassNotes.length]

      const ctx = audioContextRef.current
      const gainNode = gainNodeRef.current
      if (!ctx || !gainNode || isMuted) return

      const osc = ctx.createOscillator()
      const bassGain = ctx.createGain()
      const filter = ctx.createBiquadFilter()

      osc.type = "sawtooth"
      osc.frequency.setValueAtTime(note, ctx.currentTime)

      filter.type = "lowpass"
      filter.frequency.setValueAtTime(300, ctx.currentTime)
      filter.Q.value = 5

      bassGain.gain.setValueAtTime(0.25, ctx.currentTime)
      bassGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)

      osc.connect(filter)
      filter.connect(bassGain)
      bassGain.connect(gainNode)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.25)
    },
    [isMuted],
  )

  const playArpeggio = useCallback(
    (step: number) => {
      const arpNotes = [261.63, 329.63, 392, 523.25, 392, 329.63]
      const note = arpNotes[step % arpNotes.length]
      playNote(note, 0.1, "square", 0)
    },
    [playNote],
  )

  const startMusic = useCallback(() => {
    if (isPlayingRef.current) return

    if (!audioContextRef.current) {
      initAudio()
    }

    isPlayingRef.current = true
    console.log("[v0] Music started")

    let step = 0
    const bpm = 128
    const stepTime = (60 / bpm / 2) * 1000

    intervalRef.current = setInterval(() => {
      if (!isPlayingRef.current) return

      if (step % 4 === 0) {
        playKick()
      }

      playHiHat()

      if (step % 2 === 0) {
        playBassline(step / 2)
      }

      if (step % 2 === 1) {
        playArpeggio(step)
      }

      step++
    }, stepTime)
  }, [playKick, playHiHat, playBassline, playArpeggio, initAudio])

  const stopMusic = useCallback(() => {
    isPlayingRef.current = false
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = newMuted ? 0 : 0.2
      }
      return newMuted
    })
  }, [])

  const playTouchdown = useCallback(() => {
    if (isMuted) return
    const fanfare = [523.25, 659.25, 783.99, 1046.5]
    fanfare.forEach((freq, i) => {
      playNote(freq, 0.3, "square", i * 0.15)
    })
  }, [playNote, isMuted])

  const playSack = useCallback(() => {
    if (isMuted) return
    const ctx = audioContextRef.current
    const gainNode = gainNodeRef.current
    if (!ctx || !gainNode) return

    const osc = ctx.createOscillator()
    const sackGain = ctx.createGain()

    osc.type = "sawtooth"
    osc.frequency.setValueAtTime(200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.3)

    sackGain.gain.setValueAtTime(0.3, ctx.currentTime)
    sackGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)

    osc.connect(sackGain)
    sackGain.connect(gainNode)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  }, [isMuted])

  const playThrow = useCallback(() => {
    if (isMuted) return
    playNote(880, 0.1, "sine", 0)
    playNote(1100, 0.1, "sine", 0.05)
  }, [playNote, isMuted])

  useEffect(() => {
    if (isPlaying) {
      initAudio()
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume()
      }
      startMusic()
    } else {
      stopMusic()
    }

    return () => {
      stopMusic()
    }
  }, [isPlaying, initAudio, startMusic, stopMusic])

  useEffect(() => {
    return () => {
      stopMusic()
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [stopMusic])

  return {
    isMuted,
    toggleMute,
    playTouchdown,
    playSack,
    playThrow,
    ensureAudioReady,
  }
}
