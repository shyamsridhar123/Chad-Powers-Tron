export interface Receiver {
  id: string
  position: { x: number; z: number }
  name?: string
  color?: string
  isOpen: boolean
  route?: string
}

export type CutsceneType = "none" | "game-start" | "touchdown" | "sack" | "interception"

export interface GameState {
  score: number
  downs: number
  yardsToGo: number
  lineOfScrimmage: number
  firstDownMarker: number
  sackTimer: number
  gameStatus: "menu" | "playing" | "gameover"
  cutscene: CutsceneType
  selectedReceiver: Receiver | null
  message: string | null
}

export interface PlayerProps {
  position: [number, number, number]
  color: string
  isQB?: boolean
  isDefense?: boolean
  number?: number
}
