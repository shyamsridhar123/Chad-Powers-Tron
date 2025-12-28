export interface Receiver {
  id: string
  position: { x: number; z: number }
  name?: string
  color?: string
  isOpen: boolean
  route?: string
}

export interface GameState {
  score: number
  downs: number
  sackTimer: number
  gameStatus: "menu" | "playing" | "gameover"
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
