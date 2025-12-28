"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import * as BABYLON from "@babylonjs/core"
import { GameUI } from "./game/game-ui"
import { VirtualJoystick } from "./game/virtual-joystick"
import type { GameState, Receiver, CutsceneType } from "./game/types"
import { useAudioManager } from "./game/audio-manager"
import { useIsDesktop } from "@/lib/use-device"

const FIELD_WIDTH = 36 // increased from 24 to 36
const FIELD_LENGTH = 60 // increased from 40 to 60
const FIELD_HALF_WIDTH = FIELD_WIDTH / 2 - 0.5
const FIELD_MIN_Z = -28 // adjusted for larger field
const FIELD_MAX_Z = 28 // adjusted for larger field
const ENDZONE_Z = 25 // adjusted for larger field

const triggerHaptic = (type: "light" | "medium" | "heavy" | "success" | "error") => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    switch (type) {
      case "light":
        navigator.vibrate(10)
        break
      case "medium":
        navigator.vibrate(25)
        break
      case "heavy":
        navigator.vibrate([50, 30, 50])
        break
      case "success":
        navigator.vibrate([30, 50, 30, 50, 100])
        break
      case "error":
        navigator.vibrate([100, 30, 100])
        break
    }
  }
}

const clampToField = (pos: BABYLON.Vector3) => {
  pos.x = Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, pos.x))
  pos.z = Math.max(FIELD_MIN_Z, Math.min(FIELD_MAX_Z, pos.z))
  return pos
}

export function FootballGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<BABYLON.Engine | null>(null)
  const sceneRef = useRef<BABYLON.Scene | null>(null)
  const glowLayerRef = useRef<BABYLON.GlowLayer | null>(null)
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null)
  const ballTrailRef = useRef<BABYLON.ParticleSystem | null>(null)

  const qbRef = useRef<BABYLON.TransformNode | null>(null)
  const receiversRef = useRef<{ mesh: BABYLON.Mesh; group: BABYLON.TransformNode; data: Receiver }[]>([])
  const defendersRef = useRef<
    { mesh: BABYLON.Mesh; group: BABYLON.TransformNode; target: string; basePos: BABYLON.Vector3 }[]
  >([])
  const offenseLineRef = useRef<BABYLON.TransformNode[]>([])
  const ballRef = useRef<BABYLON.Mesh | null>(null)
  const firstDownMarkerRef = useRef<BABYLON.Mesh | null>(null)
  const lineOfScrimmageRef = useRef<number>(-15)

  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    downs: 1,
    yardsToGo: 10,
    lineOfScrimmage: -15,
    firstDownMarker: -5,
    gameStatus: "menu",
    cutscene: "none",
    sackTimer: 5,
    message: null,
    selectedReceiver: null,
  })
  const [uiReceivers, setUiReceivers] = useState<Receiver[]>([
    { id: "wr1", position: { x: -8, z: -10 }, isOpen: true },
    { id: "wr2", position: { x: 8, z: -10 }, isOpen: true },
  ])

  const { isMuted, toggleMute, playTouchdown, playSack, playThrow, ensureAudioReady } = useAudioManager(
    gameState.gameStatus === "playing",
  )

  const gameStateRef = useRef(gameState)
  const joystickRef = useRef({ x: 0, y: 0 })
  const keyboardRef = useRef({ w: false, a: false, s: false, d: false })
  const playStartedRef = useRef(false)
  const ballThrownRef = useRef(false)
  const playEndedRef = useRef(false) // Prevents sacks after play is over
  const isDesktop = useIsDesktop()
  const ballTargetRef = useRef<BABYLON.Vector3 | null>(null)
  const animationTimeRef = useRef(0)
  const shakeIntensityRef = useRef(0)
  const originalCameraTargetRef = useRef<BABYLON.Vector3 | null>(null)
  const sceneInitializedRef = useRef(false)

  const ballFlightRef = useRef<{
    startPos: BABYLON.Vector3
    targetPos: BABYLON.Vector3
    startTime: number
    duration: number
    maxHeight: number
  } | null>(null)

  // Cutscene state
  const cutsceneActiveRef = useRef<CutsceneType>("none")
  const cutsceneAnimationsRef = useRef<BABYLON.Animatable[]>([])
  const [showLetterbox, setShowLetterbox] = useState(false)
  const [canSkipCutscene, setCanSkipCutscene] = useState(false)

  const audioFunctionsRef = useRef({ playTouchdown, playSack, playThrow })

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    audioFunctionsRef.current = { playTouchdown, playSack, playThrow }
  }, [playTouchdown, playSack, playThrow])

  // Keyboard controls for desktop
  useEffect(() => {
    if (!isDesktop) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        keyboardRef.current[key as "w" | "a" | "s" | "d"] = true
        // Start play on first keypress
        if (!playStartedRef.current && gameStateRef.current.gameStatus === "playing") {
          playStartedRef.current = true
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        keyboardRef.current[key as "w" | "a" | "s" | "d"] = false
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [isDesktop])

  const handleJoystickMove = useCallback((x: number, y: number) => {
    joystickRef.current = { x, y }
    if ((Math.abs(x) > 0.1 || Math.abs(y) > 0.1) && !playStartedRef.current) {
      playStartedRef.current = true
    }
  }, [])

  // Stop all active cutscene animations
  const stopCutsceneAnimations = useCallback(() => {
    cutsceneAnimationsRef.current.forEach((anim) => anim.stop())
    cutsceneAnimationsRef.current = []
  }, [])

  // Skip cutscene handler
  const skipCutscene = useCallback(() => {
    if (!canSkipCutscene || cutsceneActiveRef.current === "none") return
    
    stopCutsceneAnimations()
    cutsceneActiveRef.current = "none"
    setShowLetterbox(false)
    setCanSkipCutscene(false)
    setGameState((prev) => ({ ...prev, cutscene: "none" }))
    
    // Reset camera to default position
    if (cameraRef.current) {
      cameraRef.current.alpha = -Math.PI / 2
      cameraRef.current.beta = Math.PI / 2.8
      cameraRef.current.radius = 60
      cameraRef.current.target = new BABYLON.Vector3(0, 0, -2)
    }
  }, [canSkipCutscene, stopCutsceneAnimations])

  const startGame = useCallback(() => {
    ensureAudioReady()
    setGameState({
      score: 0,
      downs: 1,
      yardsToGo: 10,
      lineOfScrimmage: -15,
      firstDownMarker: -5,
      gameStatus: "playing",
      cutscene: "game-start",
      sackTimer: 5,
      message: null,
      selectedReceiver: null,
    })
    playStartedRef.current = false
    ballThrownRef.current = false
    playEndedRef.current = false
    cutsceneActiveRef.current = "game-start"
  }, [ensureAudioReady])

  const restartGame = useCallback(() => {
    ensureAudioReady()
    setGameState({
      score: 0,
      downs: 1,
      yardsToGo: 10,
      lineOfScrimmage: -15,
      firstDownMarker: -5,
      gameStatus: "playing",
      cutscene: "game-start",
      sackTimer: 5,
      message: null,
      selectedReceiver: null,
    })
    playStartedRef.current = false
    ballThrownRef.current = false
    playEndedRef.current = false
    cutsceneActiveRef.current = "game-start"
  }, [ensureAudioReady])

  useEffect(() => {
    if (!canvasRef.current || sceneInitializedRef.current) return
    sceneInitializedRef.current = true

    const engine = new BABYLON.Engine(canvasRef.current, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    })
    engineRef.current = engine

    const scene = new BABYLON.Scene(engine)
    sceneRef.current = scene
    scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1)

    const glowLayer = new BABYLON.GlowLayer("glow", scene, {
      mainTextureFixedSize: 256,
      blurKernelSize: 32,
    })
    glowLayer.intensity = 0.3
    glowLayerRef.current = glowLayer

    const camera = new BABYLON.ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 2.8,
      60,
      new BABYLON.Vector3(0, 0, -2),
      scene,
    )
    camera.lowerRadiusLimit = 65
    camera.upperRadiusLimit = 100
    camera.inputs.clear()
    cameraRef.current = camera
    originalCameraTargetRef.current = camera.target.clone()

    const pipeline = new BABYLON.DefaultRenderingPipeline("default", true, scene, [camera])
    pipeline.bloomEnabled = true
    pipeline.bloomThreshold = 0.9
    pipeline.bloomWeight = 0.05
    pipeline.bloomKernel = 16
    pipeline.bloomScale = 0.15
    pipeline.fxaaEnabled = true
    pipeline.imageProcessingEnabled = true
    pipeline.imageProcessing.contrast = 1.05
    pipeline.imageProcessing.exposure = 0.95
    pipeline.imageProcessing.toneMappingEnabled = true
    pipeline.imageProcessing.vignetteEnabled = true
    pipeline.imageProcessing.vignetteWeight = 2
    pipeline.imageProcessing.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY

    const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene)
    ambient.intensity = 0.6
    ambient.groundColor = new BABYLON.Color3(0.05, 0.05, 0.1)

    const light1 = new BABYLON.PointLight("light1", new BABYLON.Vector3(-20, 30, -30), scene)
    light1.diffuse = new BABYLON.Color3(1, 1, 0.95)
    light1.intensity = 1.5

    const light2 = new BABYLON.PointLight("light2", new BABYLON.Vector3(20, 30, -30), scene)
    light2.diffuse = new BABYLON.Color3(1, 1, 0.95)
    light2.intensity = 1.5

    const cyanLight = new BABYLON.PointLight("cyan", new BABYLON.Vector3(0, 15, 25), scene)
    cyanLight.diffuse = new BABYLON.Color3(0, 1, 1)
    cyanLight.intensity = 0.8

    const magentaLight = new BABYLON.PointLight("magenta", new BABYLON.Vector3(0, 15, -30), scene)
    magentaLight.diffuse = new BABYLON.Color3(1, 0, 0.8)
    magentaLight.intensity = 0.5

    // Create field
    const createField = () => {
      const fieldWidth = FIELD_WIDTH
      const fieldLength = FIELD_LENGTH

      const field = BABYLON.MeshBuilder.CreateGround("field", { width: fieldWidth, height: fieldLength }, scene)
      const fieldMat = new BABYLON.StandardMaterial("fieldMat", scene)
      fieldMat.diffuseColor = new BABYLON.Color3(0.02, 0.04, 0.02)
      fieldMat.emissiveColor = new BABYLON.Color3(0, 0, 0)
      fieldMat.specularColor = new BABYLON.Color3(0, 0, 0)
      field.material = fieldMat
      field.position.y = -0.01

      const gridMat = new BABYLON.StandardMaterial("gridMat", scene)
      gridMat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.15)
      gridMat.emissiveColor = new BABYLON.Color3(0.02, 0.05, 0.02)

      for (let x = -fieldWidth / 2; x <= fieldWidth / 2; x += 6) {
        const gridLine = BABYLON.MeshBuilder.CreateBox(
          "gridV",
          { width: 0.03, height: 0.01, depth: fieldLength },
          scene,
        )
        gridLine.position = new BABYLON.Vector3(x, 0.01, 0)
        gridLine.material = gridMat
      }

      for (let z = -fieldLength / 2; z <= fieldLength / 2; z += 6) {
        const gridLine = BABYLON.MeshBuilder.CreateBox("gridH", { width: fieldWidth, height: 0.01, depth: 0.03 }, scene)
        gridLine.position = new BABYLON.Vector3(0, 0.01, z)
        gridLine.material = gridMat
      }

      for (let z = -25; z <= 25; z += 10) {
        const isEndZone = Math.abs(z) === 25
        const yardLine = BABYLON.MeshBuilder.CreateBox(
          "yardLine",
          { width: fieldWidth, height: 0.02, depth: isEndZone ? 0.3 : 0.15 },
          scene,
        )
        yardLine.position = new BABYLON.Vector3(0, 0.02, z)

        const lineMat = new BABYLON.StandardMaterial("lineMat", scene)
        if (isEndZone) {
          lineMat.diffuseColor = new BABYLON.Color3(0, 0.9, 0.9)
          lineMat.emissiveColor = new BABYLON.Color3(0, 0.3, 0.3)
          glowLayer.addIncludedOnlyMesh(yardLine)
        } else {
          lineMat.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.8)
          lineMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05)
        }
        yardLine.material = lineMat
      }

      const sidelinePositions = [-fieldWidth / 2, fieldWidth / 2]
      sidelinePositions.forEach((x) => {
        const sideline = BABYLON.MeshBuilder.CreateBox(
          "sideline",
          { width: 0.25, height: 0.03, depth: fieldLength },
          scene,
        )
        sideline.position = new BABYLON.Vector3(x, 0.02, 0)
        const sideMat = new BABYLON.StandardMaterial("sideMat", scene)
        sideMat.diffuseColor = new BABYLON.Color3(0.9, 0, 0.6)
        sideMat.emissiveColor = new BABYLON.Color3(0.3, 0, 0.2)
        sideline.material = sideMat
        glowLayer.addIncludedOnlyMesh(sideline)
      })

      const offenseEndzone = BABYLON.MeshBuilder.CreateGround("offenseEZ", { width: fieldWidth, height: 6 }, scene)
      offenseEndzone.position = new BABYLON.Vector3(0, 0.001, -ENDZONE_Z)
      const offenseEZMat = new BABYLON.StandardMaterial("offenseEZMat", scene)
      offenseEZMat.diffuseColor = new BABYLON.Color3(0.02, 0.06, 0.06)
      offenseEZMat.emissiveColor = new BABYLON.Color3(0, 0, 0)
      offenseEndzone.material = offenseEZMat

      const defenseEndzone = BABYLON.MeshBuilder.CreateGround("defenseEZ", { width: fieldWidth, height: 6 }, scene)
      defenseEndzone.position = new BABYLON.Vector3(0, 0.001, ENDZONE_Z)
      const defenseEZMat = new BABYLON.StandardMaterial("defenseEZMat", scene)
      defenseEZMat.diffuseColor = new BABYLON.Color3(0.15, 0.4, 0.15) // Brighter green for scoring zone
      defenseEZMat.emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.05) // Subtle glow
      defenseEndzone.material = defenseEZMat
      
      // Add "SCORE" text indicator in endzone
      const endzoneMarker = BABYLON.MeshBuilder.CreateBox("endzoneMarker", { width: 8, height: 0.05, depth: 0.4 }, scene)
      endzoneMarker.position = new BABYLON.Vector3(0, 0.03, ENDZONE_Z)
      const endzoneMarkerMat = new BABYLON.StandardMaterial("endzoneMarkerMat", scene)
      endzoneMarkerMat.diffuseColor = new BABYLON.Color3(0, 1, 0.5)
      endzoneMarkerMat.emissiveColor = new BABYLON.Color3(0, 0.5, 0.25)
      endzoneMarker.material = endzoneMarkerMat
      glowLayer.addIncludedOnlyMesh(endzoneMarker)

      const ezLinePositions = [-ENDZONE_Z - 3, ENDZONE_Z + 3]
      ezLinePositions.forEach((z, i) => {
        const ezLine = BABYLON.MeshBuilder.CreateBox("ezLine", { width: fieldWidth, height: 0.03, depth: 0.3 }, scene)
        ezLine.position = new BABYLON.Vector3(0, 0.02, z)
        const ezMat = new BABYLON.StandardMaterial("ezMat", scene)
        ezMat.diffuseColor = i === 0 ? new BABYLON.Color3(0, 0.9, 0.9) : new BABYLON.Color3(0.9, 0, 0.5)
        ezMat.emissiveColor = i === 0 ? new BABYLON.Color3(0, 0.2, 0.2) : new BABYLON.Color3(0.2, 0, 0.1)
        ezLine.material = ezMat
        glowLayer.addIncludedOnlyMesh(ezLine)
      })

      // First-down marker line (yellow/orange glowing line)
      const firstDownLine = BABYLON.MeshBuilder.CreateBox(
        "firstDownLine",
        { width: fieldWidth, height: 0.04, depth: 0.25 },
        scene,
      )
      firstDownLine.position = new BABYLON.Vector3(0, 0.03, -5) // Initial position at first down marker
      const firstDownMat = new BABYLON.StandardMaterial("firstDownMat", scene)
      firstDownMat.diffuseColor = new BABYLON.Color3(1, 0.7, 0)
      firstDownMat.emissiveColor = new BABYLON.Color3(0.5, 0.3, 0)
      firstDownLine.material = firstDownMat
      glowLayer.addIncludedOnlyMesh(firstDownLine)
      firstDownMarkerRef.current = firstDownLine
    }

    // Create player function
    const createPlayer = (
      pos: BABYLON.Vector3,
      primaryColor: string,
      secondaryColor: string,
      isQB = false,
      isDefense = false,
      isLineman = false,
    ) => {
      const group = new BABYLON.TransformNode("playerGroup", scene)
      group.position = pos.clone()

      // Scale factor for player size
      const scale = isLineman ? 1.15 : 1.0

      // Create limb groups for animation
      const leftLegGroup = new BABYLON.TransformNode("leftLegGroup", scene)
      leftLegGroup.parent = group
      leftLegGroup.position = new BABYLON.Vector3(-0.35 * scale, 1.1 * scale, 0)

      const rightLegGroup = new BABYLON.TransformNode("rightLegGroup", scene)
      rightLegGroup.parent = group
      rightLegGroup.position = new BABYLON.Vector3(0.35 * scale, 1.1 * scale, 0)

      const leftArmGroup = new BABYLON.TransformNode("leftArmGroup", scene)
      leftArmGroup.parent = group
      leftArmGroup.position = new BABYLON.Vector3(-0.7 * scale, 2.8 * scale, 0)

      const rightArmGroup = new BABYLON.TransformNode("rightArmGroup", scene)
      rightArmGroup.parent = group
      rightArmGroup.position = new BABYLON.Vector3(0.7 * scale, 2.8 * scale, 0)

      // Materials
      const skinMat = new BABYLON.StandardMaterial("skinMat", scene)
      skinMat.diffuseColor = new BABYLON.Color3(0.85, 0.65, 0.5)

      const jerseyMat = new BABYLON.StandardMaterial("jerseyMat", scene)
      jerseyMat.diffuseColor = BABYLON.Color3.FromHexString(secondaryColor)
      jerseyMat.emissiveColor = BABYLON.Color3.FromHexString(secondaryColor).scale(0.15)

      const pantsMat = new BABYLON.StandardMaterial("pantsMat", scene)
      pantsMat.diffuseColor = BABYLON.Color3.FromHexString(primaryColor).scale(0.7)

      const helmetMat = new BABYLON.StandardMaterial("helmetMat", scene)
      helmetMat.diffuseColor = BABYLON.Color3.FromHexString(primaryColor)
      helmetMat.emissiveColor = BABYLON.Color3.FromHexString(primaryColor).scale(0.25)

      const shoeMat = new BABYLON.StandardMaterial("shoeMat", scene)
      shoeMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.1)

      // TORSO - Athletic build
      const torso = BABYLON.MeshBuilder.CreateCylinder(
        "torso",
        { height: 1.2 * scale, diameterTop: 0.9 * scale, diameterBottom: 0.7 * scale },
        scene,
      )
      torso.position.y = 2.0 * scale
      torso.parent = group
      torso.material = jerseyMat

      // SHOULDER PADS
      const shoulderPads = BABYLON.MeshBuilder.CreateBox(
        "shoulderPads",
        { width: 1.4 * scale, height: 0.25 * scale, depth: 0.6 * scale },
        scene,
      )
      shoulderPads.position.y = 2.6 * scale
      shoulderPads.parent = group
      shoulderPads.material = helmetMat
      glowLayer.addIncludedOnlyMesh(shoulderPads)

      // HIP/WAIST
      const hips = BABYLON.MeshBuilder.CreateCylinder(
        "hips",
        { height: 0.4 * scale, diameterTop: 0.7 * scale, diameterBottom: 0.75 * scale },
        scene,
      )
      hips.position.y = 1.2 * scale
      hips.parent = group
      hips.material = pantsMat

      // NECK
      const neck = BABYLON.MeshBuilder.CreateCylinder("neck", { height: 0.2 * scale, diameter: 0.3 * scale }, scene)
      neck.position.y = 2.85 * scale
      neck.parent = group
      neck.material = skinMat

      // HEAD with Helmet
      const head = BABYLON.MeshBuilder.CreateSphere("head", { diameter: 0.7 * scale }, scene)
      head.position.y = 3.3 * scale
      head.parent = group
      head.material = helmetMat
      glowLayer.addIncludedOnlyMesh(head)

      // FACE MASK
      const faceMask = BABYLON.MeshBuilder.CreateTorus(
        "faceMask",
        { diameter: 0.45 * scale, thickness: 0.03 * scale, tessellation: 16 },
        scene,
      )
      faceMask.position.y = 3.25 * scale
      faceMask.position.z = 0.28 * scale
      faceMask.rotation.x = Math.PI / 2
      faceMask.parent = group
      const faceMaskMat = new BABYLON.StandardMaterial("faceMaskMat", scene)
      faceMaskMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3)
      faceMaskMat.emissiveColor = BABYLON.Color3.FromHexString(primaryColor).scale(0.2)
      faceMask.material = faceMaskMat
      glowLayer.addIncludedOnlyMesh(faceMask)

      // VISOR
      const visor = BABYLON.MeshBuilder.CreateBox(
        "visor",
        { width: 0.5 * scale, height: 0.15 * scale, depth: 0.05 * scale },
        scene,
      )
      visor.position.y = 3.35 * scale
      visor.position.z = 0.35 * scale
      visor.parent = group
      const visorMat = new BABYLON.StandardMaterial("visorMat", scene)
      visorMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05)
      visorMat.emissiveColor = BABYLON.Color3.FromHexString(primaryColor).scale(0.4)
      visorMat.alpha = 0.8
      visor.material = visorMat
      glowLayer.addIncludedOnlyMesh(visor)

      // LEFT LEG (upper thigh + lower leg + foot)
      const leftThigh = BABYLON.MeshBuilder.CreateCylinder(
        "leftThigh",
        { height: 0.6 * scale, diameterTop: 0.32 * scale, diameterBottom: 0.26 * scale },
        scene,
      )
      leftThigh.position.y = -0.3 * scale
      leftThigh.parent = leftLegGroup
      leftThigh.material = pantsMat

      const leftShin = BABYLON.MeshBuilder.CreateCylinder(
        "leftShin",
        { height: 0.55 * scale, diameterTop: 0.24 * scale, diameterBottom: 0.18 * scale },
        scene,
      )
      leftShin.position.y = -0.85 * scale
      leftShin.parent = leftLegGroup
      leftShin.material = skinMat

      const leftFoot = BABYLON.MeshBuilder.CreateBox(
        "leftFoot",
        { width: 0.2 * scale, height: 0.1 * scale, depth: 0.35 * scale },
        scene,
      )
      leftFoot.position.y = -1.15 * scale
      leftFoot.position.z = 0.08 * scale
      leftFoot.parent = leftLegGroup
      leftFoot.material = shoeMat

      // RIGHT LEG
      const rightThigh = BABYLON.MeshBuilder.CreateCylinder(
        "rightThigh",
        { height: 0.6 * scale, diameterTop: 0.32 * scale, diameterBottom: 0.26 * scale },
        scene,
      )
      rightThigh.position.y = -0.3 * scale
      rightThigh.parent = rightLegGroup
      rightThigh.material = pantsMat

      const rightShin = BABYLON.MeshBuilder.CreateCylinder(
        "rightShin",
        { height: 0.55 * scale, diameterTop: 0.24 * scale, diameterBottom: 0.18 * scale },
        scene,
      )
      rightShin.position.y = -0.85 * scale
      rightShin.parent = rightLegGroup
      rightShin.material = skinMat

      const rightFoot = BABYLON.MeshBuilder.CreateBox(
        "rightFoot",
        { width: 0.2 * scale, height: 0.1 * scale, depth: 0.35 * scale },
        scene,
      )
      rightFoot.position.y = -1.15 * scale
      rightFoot.position.z = 0.08 * scale
      rightFoot.parent = rightLegGroup
      rightFoot.material = shoeMat

      // LEFT ARM (upper arm + forearm + hand)
      const leftUpperArm = BABYLON.MeshBuilder.CreateCylinder(
        "leftUpperArm",
        { height: 0.45 * scale, diameterTop: 0.18 * scale, diameterBottom: 0.16 * scale },
        scene,
      )
      leftUpperArm.position.y = -0.25 * scale
      leftUpperArm.parent = leftArmGroup
      leftUpperArm.material = jerseyMat

      const leftForearm = BABYLON.MeshBuilder.CreateCylinder(
        "leftForearm",
        { height: 0.4 * scale, diameterTop: 0.14 * scale, diameterBottom: 0.12 * scale },
        scene,
      )
      leftForearm.position.y = -0.65 * scale
      leftForearm.parent = leftArmGroup
      leftForearm.material = skinMat

      const leftHand = BABYLON.MeshBuilder.CreateSphere("leftHand", { diameter: 0.15 * scale }, scene)
      leftHand.position.y = -0.9 * scale
      leftHand.parent = leftArmGroup
      leftHand.material = skinMat

      // RIGHT ARM
      const rightUpperArm = BABYLON.MeshBuilder.CreateCylinder(
        "rightUpperArm",
        { height: 0.45 * scale, diameterTop: 0.18 * scale, diameterBottom: 0.16 * scale },
        scene,
      )
      rightUpperArm.position.y = -0.25 * scale
      rightUpperArm.parent = rightArmGroup
      rightUpperArm.material = jerseyMat

      const rightForearm = BABYLON.MeshBuilder.CreateCylinder(
        "rightForearm",
        { height: 0.4 * scale, diameterTop: 0.14 * scale, diameterBottom: 0.12 * scale },
        scene,
      )
      rightForearm.position.y = -0.65 * scale
      rightForearm.parent = rightArmGroup
      rightForearm.material = skinMat

      const rightHand = BABYLON.MeshBuilder.CreateSphere("rightHand", { diameter: 0.15 * scale }, scene)
      rightHand.position.y = -0.9 * scale
      rightHand.parent = rightArmGroup
      rightHand.material = skinMat

      // Jersey number on back
      const numberPlane = BABYLON.MeshBuilder.CreatePlane("number", { width: 0.4 * scale, height: 0.4 * scale }, scene)
      numberPlane.position.y = 2.1 * scale
      numberPlane.position.z = -0.36 * scale
      numberPlane.rotation.y = Math.PI
      numberPlane.parent = group
      const numberMat = new BABYLON.StandardMaterial("numberMat", scene)
      numberMat.diffuseColor = BABYLON.Color3.FromHexString(primaryColor)
      numberMat.emissiveColor = BABYLON.Color3.FromHexString(primaryColor).scale(0.3)
      numberPlane.material = numberMat
      glowLayer.addIncludedOnlyMesh(numberPlane)

      // Click mesh for interaction
      const clickMesh = BABYLON.MeshBuilder.CreateCylinder(
        "clickArea",
        { height: 4 * scale, diameter: 3 * scale },
        scene,
      )
      clickMesh.position.y = 2 * scale
      clickMesh.parent = group
      clickMesh.visibility = 0

      return {
        clickMesh,
        group,
        leftLegGroup,
        rightLegGroup,
        leftArmGroup,
        rightArmGroup,
        // Keep old references for compatibility
        leftLeg: leftLegGroup,
        rightLeg: rightLegGroup,
        leftArm: leftArmGroup,
        rightArm: rightArmGroup,
      }
    }

    // Create football
    const createFootball = () => {
      const ball = BABYLON.MeshBuilder.CreateSphere("ball", { diameter: 0.35 }, scene)
      ball.scaling = new BABYLON.Vector3(1, 0.6, 1.5)
      ball.position = new BABYLON.Vector3(0.3, 1.5, -9.5)
      ball.rotation.x = Math.PI / 2

      const ballMat = new BABYLON.StandardMaterial("ballMat", scene)
      ballMat.diffuseColor = new BABYLON.Color3(0.5, 0.25, 0.05)
      ballMat.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0.01)
      ball.material = ballMat

      const lacesMat = new BABYLON.StandardMaterial("lacesMat", scene)
      lacesMat.diffuseColor = new BABYLON.Color3(1, 1, 1)
      lacesMat.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3)

      const laces = BABYLON.MeshBuilder.CreateBox("laces", { width: 0.08, height: 0.02, depth: 0.2 }, scene)
      laces.position.y = 0.12
      laces.parent = ball
      laces.material = lacesMat
      glowLayer.addIncludedOnlyMesh(laces)

      return ball
    }

    // Create ball trail
    const createBallTrail = () => {
      const particleSystem = new BABYLON.ParticleSystem("ballTrail", 100, scene)

      const size = 64
      const data = new Uint8Array(size * size * 4)
      for (let i = 0; i < size * size; i++) {
        const x = (i % size) - size / 2
        const y = Math.floor(i / size) - size / 2
        const dist = Math.sqrt(x * x + y * y) / (size / 2)
        const alpha = Math.max(0, 1 - dist * dist)
        data[i * 4] = 255
        data[i * 4 + 1] = 255
        data[i * 4 + 2] = 255
        data[i * 4 + 3] = alpha * 255
      }

      const texture = new BABYLON.RawTexture(data, size, size, BABYLON.Engine.TEXTUREFORMAT_RGBA, scene)
      particleSystem.particleTexture = texture

      particleSystem.color1 = new BABYLON.Color4(0, 1, 1, 0.8)
      particleSystem.color2 = new BABYLON.Color4(0, 0.5, 1, 0.4)
      particleSystem.colorDead = new BABYLON.Color4(0, 0, 0.5, 0)

      particleSystem.minSize = 0.1
      particleSystem.maxSize = 0.3
      particleSystem.minLifeTime = 0.1
      particleSystem.maxLifeTime = 0.3
      particleSystem.emitRate = 60
      particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD
      particleSystem.direction1 = new BABYLON.Vector3(-0.5, -0.5, -0.5)
      particleSystem.direction2 = new BABYLON.Vector3(0.5, 0.5, 0.5)
      particleSystem.minEmitPower = 0.1
      particleSystem.maxEmitPower = 0.3

      return particleSystem
    }

    // Create celebration particles
    const createCelebrationParticles = (position: BABYLON.Vector3, color?: BABYLON.Color4) => {
      const particleSystem = new BABYLON.ParticleSystem("celebration", 200, scene)

      const size = 32
      const data = new Uint8Array(size * size * 4)
      for (let i = 0; i < size * size; i++) {
        const x = (i % size) - size / 2
        const y = Math.floor(i / size) - size / 2
        const dist = Math.sqrt(x * x + y * y) / (size / 2)
        const alpha = Math.max(0, 1 - dist)
        data[i * 4] = 255
        data[i * 4 + 1] = 255
        data[i * 4 + 2] = 255
        data[i * 4 + 3] = alpha * 255
      }

      const texture = new BABYLON.RawTexture(data, size, size, BABYLON.Engine.TEXTUREFORMAT_RGBA, scene)
      particleSystem.particleTexture = texture
      particleSystem.emitter = position

      if (color) {
        particleSystem.color1 = color
        particleSystem.color2 = new BABYLON.Color4(color.r * 0.5, color.g * 0.5, color.b * 0.5, 0.8)
      } else {
        particleSystem.color1 = new BABYLON.Color4(0, 1, 1, 1)
        particleSystem.color2 = new BABYLON.Color4(1, 0, 1, 1)
      }
      particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0)

      particleSystem.minSize = 0.15
      particleSystem.maxSize = 0.4
      particleSystem.minLifeTime = 0.5
      particleSystem.maxLifeTime = 1.5
      particleSystem.emitRate = 150
      particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD
      particleSystem.gravity = new BABYLON.Vector3(0, -5, 0)
      particleSystem.direction1 = new BABYLON.Vector3(-3, 5, -3)
      particleSystem.direction2 = new BABYLON.Vector3(3, 8, 3)
      particleSystem.minEmitPower = 2
      particleSystem.maxEmitPower = 4
      particleSystem.targetStopDuration = 0.3

      particleSystem.start()
      setTimeout(() => particleSystem.dispose(), 2000)
    }

    // Animate player limbs
    const animatePlayer = (
      leftLegGroup: BABYLON.TransformNode,
      rightLegGroup: BABYLON.TransformNode,
      leftArmGroup: BABYLON.TransformNode,
      rightArmGroup: BABYLON.TransformNode,
      time: number,
      speed: number,
    ) => {
      const legSwing = Math.sin(time * speed * 10) * 0.4
      leftLegGroup.rotation.x = legSwing
      rightLegGroup.rotation.x = -legSwing
      leftArmGroup.rotation.x = -legSwing * 0.6
      rightArmGroup.rotation.x = legSwing * 0.6
    }

    // Create field
    createField()

    // Create offensive line
    const linePositions = [-FIELD_HALF_WIDTH / 2, FIELD_HALF_WIDTH / 2]
    offenseLineRef.current = linePositions.map((x) => {
      const { group, leftLegGroup, rightLegGroup, leftArmGroup, rightArmGroup } = createPlayer(new BABYLON.Vector3(x, 0, -10), "#00aaaa", "#001122", false, false, true)
      group.rotation.y = 0
      // Store limb references for animation
      ;(group as any).leftLegGroup = leftLegGroup
      ;(group as any).rightLegGroup = rightLegGroup
      ;(group as any).leftArmGroup = leftArmGroup
      ;(group as any).rightArmGroup = rightArmGroup
      return group
    })

    const qbResult = createPlayer(new BABYLON.Vector3(0, 0, -18), "#00ffff", "#002244", true, false)
    qbResult.group.rotation.y = 0
    qbRef.current = qbResult.group
    ;(qbResult.group as any).leftLegGroup = qbResult.leftLegGroup
    ;(qbResult.group as any).rightLegGroup = qbResult.rightLegGroup
    ;(qbResult.group as any).leftArmGroup = qbResult.leftArmGroup
    ;(qbResult.group as any).rightArmGroup = qbResult.rightArmGroup

    // Create receivers - start at line of scrimmage
    const receiverData = [
      {
        pos: new BABYLON.Vector3(-FIELD_HALF_WIDTH + 4, 0, -10),
        color: "#00ff88",
        secondary: "#002211",
        id: "wr1",
      },
      {
        pos: new BABYLON.Vector3(FIELD_HALF_WIDTH - 4, 0, -10),
        color: "#88ff00",
        secondary: "#112200",
        id: "wr2",
      },
    ]

    receiversRef.current = receiverData.map((r) => {
      const result = createPlayer(r.pos, r.color, r.secondary, false, false)
      result.group.rotation.y = 0
      ;(result.group as any).leftLegGroup = result.leftLegGroup
      ;(result.group as any).rightLegGroup = result.rightLegGroup
      ;(result.group as any).leftArmGroup = result.leftArmGroup
      ;(result.group as any).rightArmGroup = result.rightArmGroup

      const ring = BABYLON.MeshBuilder.CreateTorus("ring", { diameter: 3.5, thickness: 0.2, tessellation: 32 }, scene)
      ring.position.y = 0.1
      ring.rotation.x = Math.PI / 2
      const ringMat = new BABYLON.StandardMaterial("ringMat", scene)
      ringMat.diffuseColor = BABYLON.Color3.FromHexString("#00ff88")
      ringMat.emissiveColor = BABYLON.Color3.FromHexString("#00ff88").scale(0.5)
      ring.material = ringMat
      ring.parent = result.group
      glowLayer.addIncludedOnlyMesh(ring)
      ;(result.group as any).ring = ring

      // Large hit area for tap detection
      const hitArea = BABYLON.MeshBuilder.CreateCylinder("hitArea", { height: 3, diameter: 6 }, scene)
      hitArea.position.y = 1.5
      hitArea.parent = result.group
      hitArea.visibility = 0
      hitArea.isPickable = true
      ;(result.group as any).hitArea = hitArea

      return {
        mesh: result.clickMesh,
        group: result.group,
        data: { id: r.id, position: { x: r.pos.x, z: r.pos.z }, isOpen: true },
      }
    })

    const defenderData = [
      { pos: new BABYLON.Vector3(-4, 0, -8), target: "rusher" },
      { pos: new BABYLON.Vector3(4, 0, -8), target: "rusher" },
      { pos: new BABYLON.Vector3(-12, 0, -5), target: "corner" },
      { pos: new BABYLON.Vector3(12, 0, -5), target: "corner" },
      { pos: new BABYLON.Vector3(0, 0, 5), target: "safety" },
    ]

    defendersRef.current = defenderData.map((d, i) => {
      const result = createPlayer(d.pos, "#ff0066", "#220011", false, true)
      result.group.rotation.y = Math.PI
      ;(result.group as any).leftLegGroup = result.leftLegGroup
      ;(result.group as any).rightLegGroup = result.rightLegGroup
      ;(result.group as any).leftArmGroup = result.leftArmGroup
      ;(result.group as any).rightArmGroup = result.rightArmGroup

      return {
        mesh: result.clickMesh,
        group: result.group,
        target: d.target,
        basePos: d.pos.clone(),
      }
    })

    // Create football and trail
    ballRef.current = createFootball()
    ballTrailRef.current = createBallTrail()

    // Reset play function - positions players relative to line of scrimmage
    const resetPlay = () => {
      playStartedRef.current = false
      ballThrownRef.current = false
      playEndedRef.current = false
      ballTargetRef.current = null
      animationTimeRef.current = 0
      ballFlightRef.current = null

      if (ballTrailRef.current) {
        ballTrailRef.current.stop()
      }

      // Get current line of scrimmage from ref
      const los = lineOfScrimmageRef.current

      // Update first-down marker position from game state (not recalculated)
      if (firstDownMarkerRef.current) {
        // Use the firstDownMarker from game state, not los + 10
        firstDownMarkerRef.current.position.z = gameStateRef.current.firstDownMarker
      }

      // Position QB behind line of scrimmage
      if (qbRef.current) {
        qbRef.current.position = new BABYLON.Vector3(0, 0, los - 8)
        qbRef.current.rotation.y = 0
      }

      // Position ball with QB
      if (ballRef.current) {
        ballRef.current.position = new BABYLON.Vector3(0.3, 1.5, los + 0.5)
        ballRef.current.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0)
      }

      // Position receivers at line of scrimmage
      const receiverPositions = [
        new BABYLON.Vector3(-FIELD_HALF_WIDTH + 4, 0, los),
        new BABYLON.Vector3(FIELD_HALF_WIDTH - 4, 0, los),
      ]
      receiversRef.current.forEach((r, i) => {
        r.group.position = receiverPositions[i].clone()
        r.data.isOpen = true
        r.data.position = { x: receiverPositions[i].x, z: receiverPositions[i].z }
      })

      // Position offensive line at line of scrimmage
      const linePositions2 = [-FIELD_HALF_WIDTH / 2, FIELD_HALF_WIDTH / 2]
      offenseLineRef.current.forEach((l, i) => {
        l.position = new BABYLON.Vector3(linePositions2[i], 0, los)
        l.rotation.y = 0
        
        // Reset lineman animation state
        const oline = l as any
        if (oline.leftLegGroup) oline.leftLegGroup.rotation.x = 0
        if (oline.rightLegGroup) oline.rightLegGroup.rotation.x = 0
        if (oline.leftArmGroup) oline.leftArmGroup.rotation.x = 0
        if (oline.rightArmGroup) oline.rightArmGroup.rotation.x = 0
      })

      // Position defenders relative to line of scrimmage
      const defenderPositions = [
        { pos: new BABYLON.Vector3(-4, 0, los + 2), target: "rusher" },
        { pos: new BABYLON.Vector3(4, 0, los + 2), target: "rusher" },
        { pos: new BABYLON.Vector3(-12, 0, los + 5), target: "corner" },
        { pos: new BABYLON.Vector3(12, 0, los + 5), target: "corner" },
        { pos: new BABYLON.Vector3(0, 0, los + 15), target: "safety" },
      ]
      defendersRef.current.forEach((d, i) => {
        d.group.position = defenderPositions[i].pos.clone()
        d.basePos = defenderPositions[i].pos.clone()
        d.target = defenderPositions[i].target
        d.group.rotation.y = Math.PI
      })

      setGameState((prev) => ({
        ...prev,
        sackTimer: 5,
        selectedReceiver: null,
        message: "",
      }))
    }

    // Calculate receiver's current velocity based on their route
    const getReceiverVelocity = (receiverIndex: number, receiverPos: BABYLON.Vector3): BABYLON.Vector3 => {
      const routeSpeed = 10
      const startZ = lineOfScrimmageRef.current // Use dynamic line of scrimmage
      const distanceTraveled = receiverPos.z - startZ
      
      let velocityX = 0
      let velocityZ = routeSpeed
      
      if (receiverIndex === 0) {
        // WR1 - Post/Corner route
        const breakPoint = 8
        if (distanceTraveled < breakPoint) {
          // Stem phase - mostly vertical with slight outside release
          velocityZ = routeSpeed
          velocityX = -routeSpeed * 0.1
        } else {
          // Post-break phase - check defender to determine route direction
          const defender = defendersRef.current[2]
          const defenderInside = defender && defender.group.position.x > receiverPos.x
          if (defenderInside) {
            // Corner route (outside)
            velocityZ = routeSpeed * 0.6
            velocityX = -routeSpeed * 0.8
          } else {
            // Post route (inside)
            velocityZ = routeSpeed * 0.6
            velocityX = routeSpeed * 0.7
          }
        }
      } else {
        // WR2 - Out/Slant route
        const breakPoint = 6
        if (distanceTraveled < breakPoint) {
          // Stem phase
          velocityZ = routeSpeed
          velocityX = -routeSpeed * 0.1
        } else {
          // Post-break phase
          const defender = defendersRef.current[3]
          const defenderInside = defender && defender.group.position.x < receiverPos.x
          if (defenderInside) {
            // Out route (toward right sideline)
            velocityZ = routeSpeed * 0.4
            velocityX = routeSpeed * 0.9
          } else {
            // Slant route (toward center)
            velocityZ = routeSpeed * 0.5
            velocityX = -routeSpeed * 0.85
          }
        }
      }
      
      return new BABYLON.Vector3(velocityX, 0, velocityZ)
    }

    // Screen shake
    const triggerScreenShake = (intensity: number, duration: number) => {
      shakeIntensityRef.current = intensity
      setTimeout(() => {
        shakeIntensityRef.current = 0
        if (originalCameraTargetRef.current && cameraRef.current) {
          cameraRef.current.target = originalCameraTargetRef.current.clone()
        }
      }, duration)
    }

    // ========== CUTSCENE ANIMATION SYSTEM ==========
    
    // Animate camera to target position with easing
    const animateCameraTo = (
      targetAlpha: number,
      targetBeta: number,
      targetRadius: number,
      targetPosition: BABYLON.Vector3,
      duration: number,
      easingFunction?: BABYLON.EasingFunction,
      onComplete?: () => void
    ) => {
      if (!cameraRef.current) return

      const frameRate = 60
      const totalFrames = duration * frameRate

      // Alpha animation
      const alphaAnim = new BABYLON.Animation(
        "cameraAlpha",
        "alpha",
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      )
      alphaAnim.setKeys([
        { frame: 0, value: cameraRef.current.alpha },
        { frame: totalFrames, value: targetAlpha },
      ])
      if (easingFunction) alphaAnim.setEasingFunction(easingFunction)

      // Beta animation
      const betaAnim = new BABYLON.Animation(
        "cameraBeta",
        "beta",
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      )
      betaAnim.setKeys([
        { frame: 0, value: cameraRef.current.beta },
        { frame: totalFrames, value: targetBeta },
      ])
      if (easingFunction) betaAnim.setEasingFunction(easingFunction)

      // Radius animation
      const radiusAnim = new BABYLON.Animation(
        "cameraRadius",
        "radius",
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      )
      radiusAnim.setKeys([
        { frame: 0, value: cameraRef.current.radius },
        { frame: totalFrames, value: targetRadius },
      ])
      if (easingFunction) radiusAnim.setEasingFunction(easingFunction)

      // Target animation
      const targetAnim = new BABYLON.Animation(
        "cameraTarget",
        "target",
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      )
      targetAnim.setKeys([
        { frame: 0, value: cameraRef.current.target.clone() },
        { frame: totalFrames, value: targetPosition },
      ])
      if (easingFunction) targetAnim.setEasingFunction(easingFunction)

      const animatable = scene.beginDirectAnimation(
        cameraRef.current,
        [alphaAnim, betaAnim, radiusAnim, targetAnim],
        0,
        totalFrames,
        false,
        1,
        onComplete
      )
      
      cutsceneAnimationsRef.current.push(animatable)
      return animatable
    }

    // Play Game Start cutscene - sweeping camera reveal
    const playGameStartCutscene = () => {
      if (!cameraRef.current) return

      setShowLetterbox(true)
      
      // Start from dramatic overview angle
      cameraRef.current.alpha = -Math.PI / 4
      cameraRef.current.beta = Math.PI / 4
      cameraRef.current.radius = 100
      cameraRef.current.target = new BABYLON.Vector3(0, 0, 5)

      // Allow skip after 0.5 seconds
      setTimeout(() => setCanSkipCutscene(true), 500)

      // Smooth easing for cinematic feel
      const easing = new BABYLON.SineEase()
      easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT)

      // Animate to game view position
      animateCameraTo(
        -Math.PI / 2,    // alpha - behind players
        Math.PI / 2.8,   // beta - slightly above
        60,              // radius
        new BABYLON.Vector3(0, 0, -2),
        2.5,             // 2.5 second duration
        easing,
        () => {
          // Cutscene complete
          cutsceneActiveRef.current = "none"
          setShowLetterbox(false)
          setCanSkipCutscene(false)
          setGameState((prev) => ({ ...prev, cutscene: "none" }))
          originalCameraTargetRef.current = cameraRef.current?.target.clone() || null
        }
      )
    }

    // Play Touchdown cutscene - zoom to receiver, victory celebration
    const playTouchdownCutscene = (receiverPosition: BABYLON.Vector3) => {
      if (!cameraRef.current) return

      setShowLetterbox(true)
      setTimeout(() => setCanSkipCutscene(true), 500)

      const easing = new BABYLON.CircleEase()
      easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT)

      // Phase 1: Quick zoom to receiver
      animateCameraTo(
        cameraRef.current.alpha,
        Math.PI / 3,     // Lower angle to look up at player
        20,              // Close zoom
        receiverPosition.add(new BABYLON.Vector3(0, 2, 0)),
        0.8,
        easing,
        () => {
          // Phase 2: Orbit around for celebration
          const orbitEasing = new BABYLON.SineEase()
          orbitEasing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT)

          animateCameraTo(
            cameraRef.current!.alpha + Math.PI * 0.75, // Orbit 135 degrees
            Math.PI / 3,
            25,
            receiverPosition.add(new BABYLON.Vector3(0, 2, 0)),
            1.5,
            orbitEasing,
            () => {
              // Phase 3: Pull back to game view
              animateCameraTo(
                -Math.PI / 2,
                Math.PI / 2.8,
                60,
                new BABYLON.Vector3(0, 0, -2),
                0.7,
                easing,
                () => {
                  cutsceneActiveRef.current = "none"
                  setShowLetterbox(false)
                  setCanSkipCutscene(false)
                  setGameState((prev) => ({ ...prev, cutscene: "none" }))
                  originalCameraTargetRef.current = cameraRef.current?.target.clone() || null
                }
              )
            }
          )
        }
      )
    }

    // Play Sack cutscene - dramatic impact and pullback
    const playSackCutscene = (qbPosition: BABYLON.Vector3) => {
      if (!cameraRef.current) return

      setShowLetterbox(true)
      setTimeout(() => setCanSkipCutscene(true), 400)

      // Phase 1: Quick zoom to QB with shake
      const impactEasing = new BABYLON.BackEase(0.5)
      impactEasing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT)

      animateCameraTo(
        cameraRef.current.alpha,
        Math.PI / 2.5,
        25,
        qbPosition.add(new BABYLON.Vector3(0, 1.5, 0)),
        0.4,
        impactEasing,
        () => {
          // Intense shake at impact
          triggerScreenShake(0.8, 300)

          // Phase 2: Dramatic pullback
          setTimeout(() => {
            const pullbackEasing = new BABYLON.SineEase()
            pullbackEasing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT)

            animateCameraTo(
              -Math.PI / 2,
              Math.PI / 2.8,
              60,
              new BABYLON.Vector3(0, 0, -2),
              1.0,
              pullbackEasing,
              () => {
                cutsceneActiveRef.current = "none"
                setShowLetterbox(false)
                setCanSkipCutscene(false)
                setGameState((prev) => ({ ...prev, cutscene: "none" }))
                originalCameraTargetRef.current = cameraRef.current?.target.clone() || null
              }
            )
          }, 400)
        }
      )
    }

    // Play Interception cutscene - similar to sack but with different focus
    const playInterceptionCutscene = (ballPosition: BABYLON.Vector3) => {
      if (!cameraRef.current) return

      setShowLetterbox(true)
      setTimeout(() => setCanSkipCutscene(true), 400)

      const easing = new BABYLON.ExponentialEase(2)
      easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT)

      // Zoom to ball/interception point
      animateCameraTo(
        cameraRef.current.alpha + Math.PI / 6,
        Math.PI / 3,
        30,
        ballPosition.add(new BABYLON.Vector3(0, 2, 0)),
        0.6,
        easing,
        () => {
          triggerScreenShake(0.5, 250)

          setTimeout(() => {
            cutsceneActiveRef.current = "none"
            setShowLetterbox(false)
            setCanSkipCutscene(false)
            // Don't reset cutscene state here - let handleInterception control game over
          }, 500)
        }
      )
    }

    // ========== END CUTSCENE ANIMATION SYSTEM ==========

    // Throw ball function with improved route-aware targeting
    const throwBall = (receiver: Receiver, clickPoint?: BABYLON.Vector3) => {
      if (ballThrownRef.current || !ballRef.current || !qbRef.current) return

      setGameState((prev) => ({ ...prev, selectedReceiver: receiver }))
      ballThrownRef.current = true

      const targetReceiver = receiversRef.current.find((r) => r.data.id === receiver.id)
      if (targetReceiver) {
        const receiverIndex = receiversRef.current.indexOf(targetReceiver)
        const receiverPos = targetReceiver.group.position.clone()
        
        // Get the receiver's current velocity direction based on their route
        const velocity = getReceiverVelocity(receiverIndex, receiverPos)
        const velocityMagnitude = velocity.length()
        
        // Calculate ball flight parameters
        const distance = BABYLON.Vector3.Distance(ballRef.current.position, receiverPos)
        const ballSpeed = 32
        const flightTime = distance / ballSpeed
        
        // Lead the receiver along their route direction
        // Use the actual velocity direction, not just forward
        let leadX = receiverPos.x + velocity.x * flightTime * 0.75
        let leadZ = receiverPos.z + velocity.z * flightTime * 0.75
        
        // If a click point was provided, bias the throw toward the click direction
        // This helps when the user clicks ahead of the receiver on their route
        if (clickPoint) {
          const clickDirection = clickPoint.subtract(receiverPos)
          clickDirection.y = 0
          
          // Check if click is generally aligned with receiver's route direction
          if (clickDirection.length() > 0.1) {
            clickDirection.normalize()
            const routeDirection = velocity.clone().normalize()
            
            // Dot product to see if click aligns with route (1 = same direction, -1 = opposite)
            const alignment = BABYLON.Vector3.Dot(clickDirection, routeDirection)
            
            // If click is ahead of receiver in their route direction, add extra lead
            if (alignment > 0.3) {
              const clickDistance = BABYLON.Vector3.Distance(clickPoint, receiverPos)
              const extraLead = Math.min(clickDistance * 0.5, velocityMagnitude * flightTime * 0.3)
              leadX += routeDirection.x * extraLead
              leadZ += routeDirection.z * extraLead
            }
          }
        }
        
        // Clamp to field boundaries
        leadX = Math.max(-FIELD_HALF_WIDTH + 1, Math.min(FIELD_HALF_WIDTH - 1, leadX))
        leadZ = Math.min(ENDZONE_Z - 1, Math.max(receiverPos.z, leadZ))

        const targetPos = new BABYLON.Vector3(leadX, 1.5, leadZ)

        ballTargetRef.current = targetPos

        const throwDistance = BABYLON.Vector3.Distance(ballRef.current.position, targetPos)
        const flightDuration = throwDistance / ballSpeed
        const maxHeight = 1.5 + throwDistance * 0.08

        ballFlightRef.current = {
          startPos: ballRef.current.position.clone(),
          targetPos: targetPos,
          startTime: performance.now() / 1000,
          duration: flightDuration,
          maxHeight: maxHeight,
        }

        if (ballTrailRef.current) {
          ballTrailRef.current.emitter = ballRef.current
          ballTrailRef.current.start()
        }

        triggerHaptic("light")
        audioFunctionsRef.current.playThrow()
      }
    }

    // Handle touchdown - ends the game with a win
    const handleTouchdown = () => {
      if (playEndedRef.current) return // Prevent double-triggering
      playEndedRef.current = true
      
      // Get receiver position for cutscene
      const receiver = receiversRef.current.find((r) => r.data.id === gameStateRef.current.selectedReceiver?.id)
      const receiverPos = receiver ? receiver.group.position.clone() : (ballRef.current?.position.clone() || new BABYLON.Vector3(0, 0, ENDZONE_Z))
      
      setGameState((prev) => ({
        ...prev,
        score: prev.score + 7,
        cutscene: "touchdown",
        message: "TOUCHDOWN!",
      }))
      cutsceneActiveRef.current = "touchdown"
      triggerHaptic("success")
      audioFunctionsRef.current.playTouchdown()
      if (ballRef.current) {
        createCelebrationParticles(ballRef.current.position.clone())
      }
      
      // Play touchdown cutscene
      playTouchdownCutscene(receiverPos)
      
      // End the game after cutscene (3 seconds total for cutscene)
      setTimeout(() => {
        setGameState((prev) => ({ 
          ...prev, 
          gameStatus: "gameover",
          message: "YOU WIN!" 
        }))
      }, 3000)
    }

    // Handle catch - implements first-down chain system
    const handleCatch = () => {
      if (playEndedRef.current) return // Prevent double-triggering
      playEndedRef.current = true
      
      triggerHaptic("medium")
      
      if (!ballRef.current) return
      
      const catchPosition = ballRef.current.position.z
      const currentLOS = lineOfScrimmageRef.current
      const currentFirstDownMarker = gameStateRef.current.firstDownMarker
      
      // Check if the catch was in the endzone for a touchdown
      if (catchPosition >= ENDZONE_Z - 3) {
        setGameState((prev) => ({ ...prev, message: "COMPLETE!" }))
        setTimeout(() => handleTouchdown(), 500)
        return
      }
      
      // Calculate yards gained
      const yardsGained = catchPosition - currentLOS
      
      // Check if first down achieved
      if (catchPosition >= currentFirstDownMarker) {
        // First down! Move the chains
        const newLOS = catchPosition
        const newFirstDownMarker = Math.min(newLOS + 10, ENDZONE_Z - 1)
        const yardsToEndzone = ENDZONE_Z - newLOS
        const newYardsToGo = Math.round(Math.min(10, yardsToEndzone))
        
        // Update the line of scrimmage ref for next play positioning
        lineOfScrimmageRef.current = newLOS
        
        setGameState((prev) => ({ ...prev, message: "FIRST DOWN!" }))
        triggerHaptic("success")
        
        setTimeout(() => {
          setGameState((prev) => ({
            ...prev,
            downs: 1,
            yardsToGo: Math.max(1, newYardsToGo),
            lineOfScrimmage: newLOS,
            firstDownMarker: newFirstDownMarker,
            message: "",
          }))
          resetPlay()
        }, 1500)
      } else {
        // Short of first down - use a down
        const newDowns = gameStateRef.current.downs + 1
        const newYardsToGo = Math.round(currentFirstDownMarker - catchPosition)
        
        // Move line of scrimmage to catch position
        lineOfScrimmageRef.current = catchPosition
        
        if (newDowns > 4) {
          // Turnover on downs!
          setGameState((prev) => ({ 
            ...prev, 
            gameStatus: "gameover", 
            message: "TURNOVER ON DOWNS!" 
          }))
          triggerHaptic("error")
        } else {
          setGameState((prev) => ({ ...prev, message: "COMPLETE!" }))
          
          setTimeout(() => {
            setGameState((prev) => ({
              ...prev,
              downs: newDowns,
              yardsToGo: Math.max(1, newYardsToGo),
              lineOfScrimmage: catchPosition,
              message: "",
            }))
            resetPlay()
          }, 1500)
        }
      }
    }

    // Handle interception - immediate turnover (game over)
    const handleInterception = () => {
      if (playEndedRef.current) return // Prevent double-triggering
      playEndedRef.current = true
      
      const ballPos = ballRef.current?.position.clone() || new BABYLON.Vector3(0, 2, 0)
      
      setGameState((prev) => ({ 
        ...prev, 
        cutscene: "interception",
        message: "INTERCEPTED!" 
      }))
      cutsceneActiveRef.current = "interception"
      triggerHaptic("error")
      audioFunctionsRef.current.playSack()
      if (ballRef.current) {
        createCelebrationParticles(ballRef.current.position.clone(), new BABYLON.Color4(1, 0.5, 0, 1))
      }
      
      // Play interception cutscene
      playInterceptionCutscene(ballPos)
      
      // Set game over after cutscene
      setTimeout(() => {
        setGameState((prev) => ({ 
          ...prev, 
          gameStatus: "gameover",
          cutscene: "none"
        }))
      }, 1800)
    }

    // Handle sack - lose a down AND lose yardage (ball spotted where QB was tackled)
    const handleSack = () => {
      if (playEndedRef.current) return // Prevent double-triggering
      playEndedRef.current = true
      
      const qbPos = qbRef.current?.position.clone() || new BABYLON.Vector3(0, 0, -15)
      const newDowns = gameStateRef.current.downs + 1
      
      // Calculate yards lost - QB was tackled behind line of scrimmage
      const currentLOS = lineOfScrimmageRef.current
      const sackPosition = qbPos.z
      const yardsLost = Math.round(currentLOS - sackPosition) // Positive number = yards lost
      
      // New line of scrimmage is where QB was sacked
      const newLOS = sackPosition
      lineOfScrimmageRef.current = newLOS
      
      // Yards to go increases by yards lost
      const currentYardsToGo = gameStateRef.current.yardsToGo
      const newYardsToGo = Math.round(currentYardsToGo + yardsLost)
      
      // Set cutscene state
      setGameState((prev) => ({
        ...prev,
        cutscene: "sack",
        message: `SACKED! -${yardsLost} YDS`,
      }))
      cutsceneActiveRef.current = "sack"
      triggerHaptic("heavy")
      audioFunctionsRef.current.playSack()
      if (qbRef.current) {
        createCelebrationParticles(
          qbRef.current.position.add(new BABYLON.Vector3(0, 1, 0)),
          new BABYLON.Color4(1, 0.3, 0.3, 1),
        )
      }
      
      // Play sack cutscene
      playSackCutscene(qbPos)
      
      // Handle game state after cutscene
      setTimeout(() => {
        if (newDowns > 4) {
          setGameState((prev) => ({ 
            ...prev, 
            gameStatus: "gameover", 
            cutscene: "none",
            message: "TURNOVER ON DOWNS!" 
          }))
          triggerHaptic("error")
        } else {
          setGameState((prev) => ({
            ...prev,
            downs: newDowns,
            yardsToGo: Math.max(1, newYardsToGo),
            lineOfScrimmage: newLOS,
            cutscene: "none",
            message: "",
          }))
          resetPlay()
        }
      }, 1800)
    }

    // Handle incomplete - lose a down, no yards gained
    const handleIncomplete = () => {
      if (playEndedRef.current) return // Prevent double-triggering
      playEndedRef.current = true
      
      const newDowns = gameStateRef.current.downs + 1
      if (newDowns > 4) {
        setGameState((prev) => ({ 
          ...prev, 
          gameStatus: "gameover", 
          message: "TURNOVER ON DOWNS!" 
        }))
        triggerHaptic("error")
      } else {
        setGameState((prev) => ({
          ...prev,
          downs: newDowns,
          message: "INCOMPLETE!",
        }))
        setTimeout(() => {
          setGameState((prev) => ({ ...prev, message: "" }))
          resetPlay()
        }, 1500)
      }
      triggerHaptic("light")
      if (ballRef.current) {
        createCelebrationParticles(ballRef.current.position.clone(), new BABYLON.Color4(0.5, 0.5, 0.5, 1))
      }
    }

    // Pointer down handler for throwing
    scene.onPointerDown = (_evt, pickResult) => {
      if (gameStateRef.current.gameStatus !== "playing" || ballThrownRef.current) return

      const clickPoint = pickResult.hit && pickResult.pickedPoint ? pickResult.pickedPoint.clone() : undefined

      if (pickResult.hit && pickResult.pickedMesh) {
        const hitMesh = pickResult.pickedMesh
        for (const receiver of receiversRef.current) {
          const hitArea = (receiver.group as any).hitArea
          if (hitMesh === hitArea || hitMesh.parent === receiver.group) {
            triggerHaptic("medium")
            throwBall(receiver.data, clickPoint)
            return
          }
        }
      }

      // Proximity-based throw assist - finds closest receiver to click point
      // Also considers if click direction aligns with receiver's route for better targeting
      if (pickResult.hit && pickResult.pickedPoint) {
        const tapPoint = pickResult.pickedPoint
        let bestReceiver: (typeof receiversRef.current)[0] | null = null
        let bestScore = Infinity

        for (let i = 0; i < receiversRef.current.length; i++) {
          const receiver = receiversRef.current[i]
          const receiverPos = receiver.group.position
          
          // Calculate distance to receiver
          const dist = BABYLON.Vector3.Distance(
            new BABYLON.Vector3(tapPoint.x, 0, tapPoint.z),
            new BABYLON.Vector3(receiverPos.x, 0, receiverPos.z),
          )
          
          // Get receiver's velocity direction
          const velocity = getReceiverVelocity(i, receiverPos)
          const routeDir = velocity.clone().normalize()
          
          // Calculate direction from receiver to click
          const toClick = tapPoint.subtract(receiverPos)
          toClick.y = 0
          const clickDist = toClick.length()
          
          if (clickDist > 0.1) {
            toClick.normalize()
            
            // Bonus for clicking ahead of receiver on their route
            const alignment = BABYLON.Vector3.Dot(toClick, routeDir)
            
            // Score combines distance and route alignment
            // Lower score = better match
            // If click is ahead on route (alignment > 0), reduce score
            let score = dist
            if (alignment > 0 && clickDist < 15) {
              // Click is ahead on the route - this is a good throw target
              score = dist * (1 - alignment * 0.5)
            }
            
            if (score < bestScore && dist < 15) {
              bestScore = score
              bestReceiver = receiver
            }
          } else if (dist < bestScore && dist < 15) {
            bestScore = dist
            bestReceiver = receiver
          }
        }

        if (bestReceiver) {
          triggerHaptic("medium")
          throwBall(bestReceiver.data, clickPoint)
        }
      }
    }

    // Game loop
    let lastTime = performance.now()
    let sackTimerAccum = 0
    let gameStartCutscenePlayed = false

    scene.registerBeforeRender(() => {
      const currentTime = performance.now()
      const delta = (currentTime - lastTime) / 1000
      lastTime = currentTime

      if (gameStateRef.current.gameStatus !== "playing") return

      // Check if we need to play game start cutscene
      if (cutsceneActiveRef.current === "game-start" && !gameStartCutscenePlayed) {
        gameStartCutscenePlayed = true
        playGameStartCutscene()
        return
      }

      // During cutscenes, only update camera shake but skip gameplay
      if (cutsceneActiveRef.current !== "none") {
        // Camera shake during cutscenes
        if (shakeIntensityRef.current > 0 && cameraRef.current && originalCameraTargetRef.current) {
          const shakeX = (Math.random() - 0.5) * shakeIntensityRef.current
          const shakeY = (Math.random() - 0.5) * shakeIntensityRef.current
          cameraRef.current.target = originalCameraTargetRef.current.add(new BABYLON.Vector3(shakeX, shakeY, 0))
          shakeIntensityRef.current *= 0.95
        }
        return
      }

      // Camera shake
      if (shakeIntensityRef.current > 0 && cameraRef.current && originalCameraTargetRef.current) {
        const shakeX = (Math.random() - 0.5) * shakeIntensityRef.current
        const shakeY = (Math.random() - 0.5) * shakeIntensityRef.current
        cameraRef.current.target = originalCameraTargetRef.current.add(new BABYLON.Vector3(shakeX, shakeY, 0))
        shakeIntensityRef.current *= 0.95
      }

      if (!playStartedRef.current) return

      animationTimeRef.current += delta

      // Sack timer
      sackTimerAccum += delta
      if (sackTimerAccum >= 0.1) {
        sackTimerAccum = 0
        setGameState((prev) => {
          const newTimer = Math.max(0, prev.sackTimer - 0.1)
          if (newTimer <= 0 && !ballThrownRef.current) {
            handleSack()
          }
          return { ...prev, sackTimer: newTimer }
        })
      }

      // QB movement - merge joystick and keyboard inputs
      if (qbRef.current && !ballThrownRef.current) {
        const moveSpeed = 6
        
        // Calculate keyboard input (-1 to 1 for each axis)
        let keyboardX = 0
        let keyboardY = 0
        if (keyboardRef.current.a) keyboardX -= 1
        if (keyboardRef.current.d) keyboardX += 1
        if (keyboardRef.current.w) keyboardY += 1
        if (keyboardRef.current.s) keyboardY -= 1
        
        // Use whichever input is stronger (joystick or keyboard)
        const inputX = Math.abs(joystickRef.current.x) > Math.abs(keyboardX) ? joystickRef.current.x : keyboardX
        const inputY = Math.abs(joystickRef.current.y) > Math.abs(keyboardY) ? joystickRef.current.y : keyboardY
        
        qbRef.current.position.x += inputX * moveSpeed * delta
        qbRef.current.position.z -= inputY * moveSpeed * delta

        qbRef.current.position.x = Math.max(
          -FIELD_HALF_WIDTH + 1,
          Math.min(FIELD_HALF_WIDTH - 1, qbRef.current.position.x),
        )
        qbRef.current.position.z = Math.max(FIELD_MIN_Z + 2, Math.min(-10, qbRef.current.position.z)) // Adjusted boundaries

        if (ballRef.current) {
          ballRef.current.position.x = qbRef.current.position.x + 0.3
          ballRef.current.position.z = qbRef.current.position.z + 0.5
        }

        const qb = qbRef.current as any
        if (qb.leftLegGroup && qb.rightLegGroup && qb.leftArmGroup && qb.rightArmGroup) {
          const isMoving = Math.abs(inputX) > 0.1 || Math.abs(inputY) > 0.1
          if (isMoving) {
            animatePlayer(
              qb.leftLegGroup,
              qb.rightLegGroup,
              qb.leftArmGroup,
              qb.rightArmGroup,
              animationTimeRef.current,
              1.2,
            )
          }
        }
      }

      // Offensive line blocking
      offenseLineRef.current.forEach((lineman, i) => {
        const oline = lineman as any
        
        // Find closest rusher to block
        let closestRusher: typeof defendersRef.current[0] | null = null
        let closestDist = Infinity
        
        for (const defender of defendersRef.current) {
          if (defender.target === "rusher") {
            const dist = BABYLON.Vector3.Distance(lineman.position, defender.group.position)
            if (dist < closestDist) {
              closestDist = dist
              closestRusher = defender
            }
          }
        }
        
        // Block the rusher
        if (closestRusher && closestDist < 12) {
          const toRusher = closestRusher.group.position.subtract(lineman.position)
          toRusher.y = 0
          toRusher.normalize()
          
          // Move toward rusher to engage
          const blockSpeed = 3.5
          lineman.position.addInPlace(toRusher.scale(blockSpeed * delta))
          
          // Keep within reasonable blocking zone
          lineman.position.x = Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, lineman.position.x))
          lineman.position.z = Math.max(FIELD_MIN_Z + 2, Math.min(-8, lineman.position.z))
          
          // Face the rusher
          lineman.rotation.y = Math.atan2(toRusher.x, toRusher.z)
          
          // Animate blocking
          if (oline.leftLegGroup && oline.rightLegGroup && oline.leftArmGroup && oline.rightArmGroup) {
            animatePlayer(
              oline.leftLegGroup,
              oline.rightLegGroup,
              oline.leftArmGroup,
              oline.rightArmGroup,
              animationTimeRef.current,
              1.0,
            )
          }
        }
      })

      // Receiver routes - run intelligent routes with breaks and separation
      receiversRef.current.forEach((r, i) => {
        const routeSpeed = 10
        const startZ = lineOfScrimmageRef.current // Use dynamic line of scrimmage
        const distanceTraveled = r.group.position.z - startZ
        
        // Receivers run forward (positive z direction) from line of scrimmage
        if (r.group.position.z < ENDZONE_Z - 1) {
          if (i === 0) {
            // WR1 - Post/Corner route: Run vertical, then break diagonally
            const breakPoint = 8 // Break after 8 yards
            
            if (distanceTraveled < breakPoint) {
              // Phase 1: Run straight up the field (stem)
              r.group.position.z += routeSpeed * delta
              // Slight outside release to set up the break
              r.group.position.x -= routeSpeed * 0.1 * delta
            } else {
              // Phase 2: Break on the route - check defender position
              const defender = defendersRef.current[2] // corner defender for WR1
              const defenderInside = defender && defender.group.position.x > r.group.position.x
              
              if (defenderInside) {
                // Defender is inside - run a corner route (break outside toward sideline)
                r.group.position.z += routeSpeed * 0.6 * delta
                r.group.position.x -= routeSpeed * 0.8 * delta // Strong outside cut
              } else {
                // Defender is outside - run a post route (break inside toward middle)
                r.group.position.z += routeSpeed * 0.6 * delta
                r.group.position.x += routeSpeed * 0.7 * delta // Strong inside cut
              }
            }
          } else {
            // WR2 - Out/Slant route: Run vertical, then break sharply
            const breakPoint = 6 // Break after 6 yards (shorter route)
            
            if (distanceTraveled < breakPoint) {
              // Phase 1: Run straight up the field (stem)
              r.group.position.z += routeSpeed * delta
              // Slight inside release to set up the break (toward center = negative x)
              r.group.position.x -= routeSpeed * 0.1 * delta
            } else {
              // Phase 2: Break on the route - check defender position
              // WR2 is on the right side (positive x), so:
              // - defender.x < receiver.x means defender is INSIDE (toward center/left)
              // - defender.x > receiver.x means defender is OUTSIDE (toward right sideline)
              const defender = defendersRef.current[3] // corner defender for WR2
              const defenderInside = defender && defender.group.position.x < r.group.position.x
              
              if (defenderInside) {
                // Defender is inside (between receiver and center) - run out route toward sideline
                r.group.position.z += routeSpeed * 0.4 * delta
                r.group.position.x += routeSpeed * 0.9 * delta // Sharp outside cut (toward right sideline)
              } else {
                // Defender is outside or unknown - run slant route toward center
                r.group.position.z += routeSpeed * 0.5 * delta
                r.group.position.x -= routeSpeed * 0.85 * delta // Sharp inside cut (toward center)
              }
            }
          }
        }

        r.group.position.z = Math.min(ENDZONE_Z - 1, r.group.position.z)
        r.group.position.x = Math.max(-FIELD_HALF_WIDTH + 1, Math.min(FIELD_HALF_WIDTH - 1, r.group.position.x))

        r.data.position = { x: r.group.position.x, z: r.group.position.z }

        const rec = r.group as any
        if (rec.leftLegGroup && rec.rightLegGroup && rec.leftArmGroup && rec.rightArmGroup) {
          animatePlayer(
            rec.leftLegGroup,
            rec.rightLegGroup,
            rec.leftArmGroup,
            rec.rightArmGroup,
            animationTimeRef.current,
            1.3,
          )
        }
      })

      // Defender AI
      defendersRef.current.forEach((d, i) => {
        const def = d.group as any

        if (d.target === "rusher" && qbRef.current) {
          const toQB = qbRef.current.position.subtract(d.group.position)
          toQB.y = 0
          toQB.normalize()
          const rushSpeed = 2.5
          d.group.position.addInPlace(toQB.scale(rushSpeed * delta))

          d.group.position.x = Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, d.group.position.x))
          d.group.position.z = Math.max(FIELD_MIN_Z + 2, Math.min(-5, d.group.position.z)) // Allow rushers to chase QB into backfield

          d.group.rotation.y = Math.atan2(toQB.x, toQB.z)

          const distToQB = BABYLON.Vector3.Distance(d.group.position, qbRef.current.position)
          if (distToQB < 1.2 && !ballThrownRef.current) {
            handleSack()
          }
        } else if (d.target === "corner") {
          const targetReceiver = receiversRef.current[i - 2]
          if (targetReceiver) {
            const toReceiver = targetReceiver.group.position.subtract(d.group.position)
            toReceiver.y = 0
            toReceiver.normalize()
            const coverSpeed = 8.5
            d.group.position.addInPlace(toReceiver.scale(coverSpeed * delta))

            d.group.position.x = Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, d.group.position.x))
            d.group.position.z = Math.max(FIELD_MIN_Z + 10, Math.min(ENDZONE_Z - 1, d.group.position.z)) // Adjusted boundaries

            d.group.rotation.y = Math.atan2(toReceiver.x, toReceiver.z)

            const dist = BABYLON.Vector3.Distance(d.group.position, targetReceiver.group.position)
            targetReceiver.data.isOpen = dist > 4

            const ring = (targetReceiver.group as any).ring as BABYLON.Mesh
            if (ring) {
              const ringMat = ring.material as BABYLON.StandardMaterial
              if (targetReceiver.data.isOpen) {
                ringMat.diffuseColor = BABYLON.Color3.FromHexString("#00ff88")
                ringMat.emissiveColor = BABYLON.Color3.FromHexString("#00ff88").scale(0.5)
              } else {
                ringMat.diffuseColor = BABYLON.Color3.FromHexString("#ff2255")
                ringMat.emissiveColor = BABYLON.Color3.FromHexString("#ff2255").scale(0.5)
              }
            }
          }
        } else if (d.target === "safety") {
          // Safety moves back to cover deep
          d.group.position.z += 5 * delta
          d.group.position.z = Math.min(ENDZONE_Z - 2, d.group.position.z)
          d.group.position.x = Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, d.group.position.x))
        }

        if (def.leftLegGroup && def.rightLegGroup && def.leftArmGroup && def.rightArmGroup) {
          animatePlayer(
            def.leftLegGroup,
            def.rightLegGroup,
            def.leftArmGroup,
            def.rightArmGroup,
            animationTimeRef.current,
            1.1,
          )
        }
      })

      // Ball flight
      if (ballThrownRef.current && ballFlightRef.current && ballRef.current) {
        const flight = ballFlightRef.current
        const currentTime2 = performance.now() / 1000
        const elapsed = currentTime2 - flight.startTime
        const t = Math.min(elapsed / flight.duration, 1)

        const newX = BABYLON.Scalar.Lerp(flight.startPos.x, flight.targetPos.x, t)
        const newZ = BABYLON.Scalar.Lerp(flight.startPos.z, flight.targetPos.z, t)

        const baseY = BABYLON.Scalar.Lerp(flight.startPos.y, flight.targetPos.y, t)
        const arcHeight = 4 * flight.maxHeight * t * (1 - t)
        const newY = baseY + arcHeight

        ballRef.current.position.x = newX
        ballRef.current.position.y = newY
        ballRef.current.position.z = newZ

        ballRef.current.rotation.z += delta * 25

        if (t >= 1) {
          if (ballTrailRef.current) {
            ballTrailRef.current.stop()
          }

          const receiver = receiversRef.current.find((r) => r.data.id === gameStateRef.current.selectedReceiver?.id)
          if (receiver) {
            const distToReceiver = BABYLON.Vector3.Distance(ballRef.current.position, receiver.group.position)
            const isCatchable = distToReceiver < 5 // Increased from 3.5 for more forgiving catches

            if (isCatchable) {
              const catchChance = receiver.data.isOpen ? 0.95 : 0.55 // Increased contested catch chance from 0.35
              if (Math.random() < catchChance) {
                handleCatch()
              } else {
                handleInterception()
              }
            } else {
              handleIncomplete()
            }
          }
          ballThrownRef.current = false
          ballFlightRef.current = null
        }
      }
    })

    engine.runRenderLoop(() => {
      scene.render()
    })

    const handleResize = () => engine.resize()
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      scene.dispose()
      engine.dispose()
    }
  }, []) // Empty dependency array - only initialize once

  // Update UI receivers
  useEffect(() => {
    if (gameState.gameStatus !== "playing") return

    const interval = setInterval(() => {
      if (receiversRef.current.length > 0) {
        const updatedReceivers = receiversRef.current.map((r) => ({
          id: r.data.id,
          position: { x: r.group.position.x, z: r.group.position.z },
          isOpen: r.data.isOpen,
        }))
        setUiReceivers(updatedReceivers)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [gameState.gameStatus])

  return (
    <div className="relative w-full h-dvh bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full touch-none" />

      {gameState.gameStatus === "playing" && !isDesktop && <VirtualJoystick onMove={handleJoystickMove} />}

      {/* Letterbox overlay for cinematic cutscenes */}
      <div
        className={`absolute inset-x-0 top-0 bg-black transition-all duration-500 ease-out pointer-events-none ${
          showLetterbox ? "h-[12%]" : "h-0"
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 bg-black transition-all duration-500 ease-out pointer-events-none ${
          showLetterbox ? "h-[12%]" : "h-0"
        }`}
      />

      {/* Skip cutscene button */}
      {canSkipCutscene && (
        <button
          onClick={skipCutscene}
          className="absolute bottom-[15%] right-4 px-4 py-2 bg-black/60 border border-cyan-500/50 rounded text-cyan-400 text-sm font-medium backdrop-blur-sm hover:bg-cyan-500/20 transition-colors z-50"
        >
          Skip →
        </button>
      )}

      <GameUI
        gameState={gameState}
        onStart={startGame}
        onRestart={restartGame}
        receivers={uiReceivers}
        isMuted={isMuted}
        onToggleMute={toggleMute}
      />
    </div>
  )
}
