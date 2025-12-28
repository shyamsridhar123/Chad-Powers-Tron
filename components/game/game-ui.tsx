"use client"

import type { GameState } from "./types"
import { Button } from "@/components/ui/button"
import { Volume2, VolumeX } from "lucide-react"
import { useIsDesktop } from "@/lib/use-device"

interface GameUIProps {
  gameState: GameState
  onStart: () => void
  onRestart: () => void
  isMuted?: boolean
  onToggleMute?: () => void
}

export function GameUI({ gameState, onStart, onRestart, isMuted = false, onToggleMute }: GameUIProps) {
  const isDesktop = useIsDesktop()

  if (gameState.gameStatus === "menu") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black via-zinc-950 to-black p-4 pt-safe pb-safe">
        <div className="text-center space-y-8 max-w-sm w-full">
          <div className="space-y-2">
            <div className="relative">
              <p className="text-lg text-cyan-400 tracking-[0.2em] font-bold uppercase mb-1">TRON</p>
              <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-cyan-400 to-fuchsia-400 tracking-tighter drop-shadow-lg">
                CHAD POWERS
              </h1>
              <div className="absolute inset-0 blur-xl bg-gradient-to-r from-fuchsia-500/30 via-cyan-500/30 to-fuchsia-500/30 -z-10" />
            </div>
            <p className="text-lg text-fuchsia-400 tracking-[0.3em] font-bold uppercase">5 v 5</p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-cyan-500" />
              <span className="text-cyan-400 text-xs tracking-widest">ARCADE FOOTBALL</span>
              <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-cyan-500" />
            </div>
          </div>

          {/* Instructions - show different controls for desktop vs mobile */}
          <div className="space-y-3 text-left bg-black/60 rounded-2xl p-5 border border-fuchsia-500/40 shadow-lg shadow-fuchsia-500/10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/30">
                <span className="text-2xl">{isDesktop ? "⌨️" : "🕹️"}</span>
              </div>
              <div>
                <p className="text-white font-bold text-lg">Move QB</p>
                <p className="text-zinc-400 text-sm">{isDesktop ? "WASD keys to scramble" : "Use joystick to scramble"}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                <span className="text-2xl">{isDesktop ? "🖱️" : "👆"}</span>
              </div>
              <div>
                <p className="text-white font-bold text-lg">{isDesktop ? "Click Receiver" : "Tap Receiver"}</p>
                <p className="text-zinc-400 text-sm">{isDesktop ? "Click the glowing ring to throw" : "Tap the glowing ring to throw"}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0 shadow-lg shadow-red-500/30">
                <span className="text-2xl">⏱️</span>
              </div>
              <div>
                <p className="text-white font-bold text-lg">Beat The Rush</p>
                <p className="text-zinc-400 text-sm">Throw before getting sacked!</p>
              </div>
            </div>
          </div>

          <Button
            onClick={onStart}
            size="lg"
            className="w-full bg-gradient-to-r from-fuchsia-600 via-cyan-500 to-fuchsia-600 hover:from-fuchsia-500 hover:via-cyan-400 hover:to-fuchsia-500 text-white text-xl py-8 min-h-[64px] font-black tracking-wider rounded-2xl shadow-xl shadow-fuchsia-500/30 border border-white/20 uppercase"
          >
            HIKE!
          </Button>
        </div>
      </div>
    )
  }

  if (gameState.gameStatus === "gameover") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black via-red-950/30 to-black p-4">
        <div className="text-center space-y-8 max-w-sm w-full">
          <div className="relative">
            <h1 className="text-5xl font-black text-red-500 tracking-wider animate-pulse">GAME OVER</h1>
            <div className="absolute inset-0 blur-2xl bg-red-500/20 -z-10" />
          </div>

          <div className="bg-black/70 rounded-3xl p-8 border-2 border-red-500/50 shadow-2xl shadow-red-500/20">
            <p className="text-fuchsia-400 text-sm uppercase tracking-[0.3em] font-bold">Final Score</p>
            <p className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400 mt-4">
              {gameState.score}
            </p>
            <div className="mt-6 pt-6 border-t border-zinc-700">
              <p className="text-2xl font-bold text-white">
                {gameState.score >= 28
                  ? "HALL OF FAME!"
                  : gameState.score >= 21
                    ? "PRO BOWL!"
                    : gameState.score >= 14
                      ? "SOLID GAME!"
                      : gameState.score >= 7
                        ? "KEEP GRINDING!"
                        : "BACK TO PRACTICE!"}
              </p>
            </div>
          </div>

          <Button
            onClick={onRestart}
            size="lg"
            className="w-full bg-gradient-to-r from-cyan-600 via-fuchsia-500 to-cyan-600 hover:from-cyan-500 hover:via-fuchsia-400 hover:to-cyan-500 text-white text-xl py-8 min-h-[64px] font-black tracking-wider rounded-2xl shadow-xl shadow-cyan-500/30 border border-white/20 uppercase"
          >
            Run It Back!
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Top HUD - Arcade style scoreboard (hidden during cutscenes) */}
      <div className={`absolute inset-x-0 top-0 p-3 pt-safe transition-opacity duration-500 ${
        gameState.cutscene !== "none" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}>
        <div className="flex justify-center items-stretch gap-2 max-w-md mx-auto">
          {/* Score */}
          <div className="flex-1 bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 border-cyan-500/50 rounded-xl px-3 py-2 shadow-lg shadow-cyan-500/20">
            <div className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold text-center">Score</div>
            <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 text-center leading-none mt-1">
              {gameState.score}
            </div>
          </div>

          {/* Down & Distance */}
          <div className="flex-1 bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 border-fuchsia-500/50 rounded-xl px-3 py-2 shadow-lg shadow-fuchsia-500/20">
            <div className="text-[10px] text-fuchsia-400 uppercase tracking-widest font-bold text-center">Down</div>
            <div className="text-2xl font-black text-white text-center leading-none mt-1">
              {gameState.downs}<span className="text-lg text-zinc-400">/</span>4
            </div>
          </div>

          {/* Yards to Touchdown - IMPROVED: More prominent in RedZone */}
          <div className={`flex-1 bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 rounded-xl px-3 py-2 shadow-lg transition-all ${
            gameState.yardsToTouchdown <= 10
              ? "border-emerald-500 shadow-emerald-500/40 animate-pulse"
              : "border-emerald-500/50 shadow-emerald-500/20"
          }`}>
            <div className={`text-[10px] uppercase tracking-widest font-bold text-center ${
              gameState.yardsToTouchdown <= 10 ? "text-emerald-300" : "text-emerald-400"
            }`}>To TD</div>
            <div className={`text-2xl font-black text-center leading-none mt-1 ${
              gameState.yardsToTouchdown <= 10 ? "text-emerald-300" : "text-emerald-400"
            }`}>
              {gameState.yardsToTouchdown}<span className="text-sm text-zinc-400">yd</span>
            </div>
          </div>

          {/* Sack timer */}
          <div
            className={`flex-1 bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 rounded-xl px-3 py-2 shadow-lg transition-all ${
              gameState.sackTimer <= 3
                ? "border-red-500 shadow-red-500/40 animate-pulse"
                : "border-yellow-500/50 shadow-yellow-500/20"
            }`}
          >
            <div
              className={`text-[10px] uppercase tracking-widest font-bold text-center ${
                gameState.sackTimer <= 3 ? "text-red-400" : "text-yellow-400"
              }`}
            >
              Rush
            </div>
            <div
              className={`text-3xl font-black font-mono text-center leading-none mt-1 ${
                gameState.sackTimer <= 3 ? "text-red-500" : "text-yellow-400"
              }`}
            >
              {gameState.sackTimer.toFixed(1)}
            </div>
          </div>

          <button
            onClick={onToggleMute}
            className="bg-gradient-to-b from-zinc-800 to-zinc-900 border-2 border-zinc-600/50 rounded-xl px-3 py-2 shadow-lg flex items-center justify-center min-w-[48px] active:scale-95 transition-transform"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-6 h-6 text-zinc-500" /> : <Volume2 className="w-6 h-6 text-cyan-400" />}
          </button>
        </div>
      </div>

      {/* Message overlay */}
      {gameState.message && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div
            className={`px-12 py-6 rounded-3xl text-4xl font-black tracking-wider transform ${
              gameState.message.includes("TOUCHDOWN")
                ? "bg-emerald-500/30 text-emerald-400 border-4 border-emerald-500 shadow-2xl shadow-emerald-500/50 animate-bounce"
                : gameState.message.includes("INTERCEPTED") || gameState.message.includes("SACKED")
                  ? "bg-red-500/30 text-red-400 border-4 border-red-500 shadow-2xl shadow-red-500/50 animate-pulse"
                  : "bg-cyan-500/30 text-cyan-400 border-4 border-cyan-500 shadow-2xl shadow-cyan-500/50"
            }`}
          >
            {gameState.message}
          </div>
        </div>
      )}

      {/* RedZone indicator - MOBILE IMPROVEMENT: Visual cue when in scoring position */}
      {gameState.gameStatus === "playing" && gameState.yardsToTouchdown <= 10 && gameState.cutscene === "none" && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 pointer-events-none z-30 animate-pulse">
          <div className="bg-emerald-500/20 text-emerald-300 border-2 border-emerald-400 px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wider shadow-lg shadow-emerald-500/30">
            <span aria-label="Football">🏈</span> RedZone! {gameState.yardsToTouchdown} yards to TD!
          </div>
        </div>
      )}
    </>
  )
}
