"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import * as BABYLON from "@babylonjs/core"
import { GameUI } from "./game/game-ui"
import { VirtualJoystick } from "./game/virtual-joystick"
import type { GameState, Receiver } from "./game/types"
import { useAudioManager } from "./game/audio-manager"

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

  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    downs: 1,
    gameStatus: "menu",
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
  const playStartedRef = useRef(false)
  const ballThrownRef = useRef(false)
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

  const audioFunctionsRef = useRef({ playTouchdown, playSack, playThrow })

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    audioFunctionsRef.current = { playTouchdown, playSack, playThrow }
  }, [playTouchdown, playSack, playThrow])

  const handleJoystickMove = useCallback((x: number, y: number) => {
    joystickRef.current = { x, y }
    if ((Math.abs(x) > 0.1 || Math.abs(y) > 0.1) && !playStartedRef.current) {
      playStartedRef.current = true
    }
  }, [])

  const startGame = useCallback(() => {
    ensureAudioReady()
    setGameState({
      score: 0,
      downs: 1,
      gameStatus: "playing",
      sackTimer: 5,
      message: null,
      selectedReceiver: null,
    })
    playStartedRef.current = false
    ballThrownRef.current = false
  }, [ensureAudioReady])

  const restartGame = useCallback(() => {
    ensureAudioReady()
    setGameState({
      score: 0,
      downs: 1,
      gameStatus: "playing",
      sackTimer: 5,
      message: null,
      selectedReceiver: null,
    })
    playStartedRef.current = false
    ballThrownRef.current = false
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
      defenseEZMat.diffuseColor = new BABYLON.Color3(0.06, 0.02, 0.04)
      defenseEZMat.emissiveColor = new BABYLON.Color3(0, 0, 0)
      defenseEndzone.material = defenseEZMat

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

    // Reset play function
    const resetPlay = () => {
      playStartedRef.current = false
      ballThrownRef.current = false
      ballTargetRef.current = null
      animationTimeRef.current = 0
      ballFlightRef.current = null

      if (ballTrailRef.current) {
        ballTrailRef.current.stop()
      }

      if (qbRef.current) {
        qbRef.current.position = new BABYLON.Vector3(0, 0, -18) // Adjusted for larger field
        qbRef.current.rotation.y = 0
      }

      if (ballRef.current) {
        ballRef.current.position = new BABYLON.Vector3(0.3, 1.5, -9.5) // Adjusted for larger field
        ballRef.current.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0)
      }

      const receiverPositions = [
        new BABYLON.Vector3(-FIELD_HALF_WIDTH + 4, 0, -10),
        new BABYLON.Vector3(FIELD_HALF_WIDTH - 4, 0, -10),
      ]
      receiversRef.current.forEach((r, i) => {
        r.group.position = receiverPositions[i].clone()
        r.data.isOpen = true
        r.data.position = { x: receiverPositions[i].x, z: receiverPositions[i].z }
      })

      // Adjusted offense line positions for larger field
      const linePositions2 = [-FIELD_HALF_WIDTH / 2, FIELD_HALF_WIDTH / 2]
      offenseLineRef.current.forEach((l, i) => {
        l.position = new BABYLON.Vector3(linePositions2[i], 0, -10)
        l.rotation.y = 0
        
        // Reset lineman animation state
        const oline = l as any
        if (oline.leftLegGroup) oline.leftLegGroup.rotation.x = 0
        if (oline.rightLegGroup) oline.rightLegGroup.rotation.x = 0
        if (oline.leftArmGroup) oline.leftArmGroup.rotation.x = 0
        if (oline.rightArmGroup) oline.rightArmGroup.rotation.x = 0
      })

      const defenderPositions = [
        { pos: new BABYLON.Vector3(-4, 0, -8), target: "rusher" },
        { pos: new BABYLON.Vector3(4, 0, -8), target: "rusher" },
        { pos: new BABYLON.Vector3(-12, 0, -5), target: "corner" },
        { pos: new BABYLON.Vector3(12, 0, -5), target: "corner" },
        { pos: new BABYLON.Vector3(0, 0, 5), target: "safety" },
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

    // Throw ball function
    const throwBall = (receiver: Receiver) => {
      if (ballThrownRef.current || !ballRef.current || !qbRef.current) return

      setGameState((prev) => ({ ...prev, selectedReceiver: receiver }))
      ballThrownRef.current = true

      const targetReceiver = receiversRef.current.find((r) => r.data.id === receiver.id)
      if (targetReceiver) {
        const receiverVelocity = 10
        const distance = BABYLON.Vector3.Distance(ballRef.current.position, targetReceiver.group.position)
        const ballSpeed = 32 // Slower ball for more playable experience
        const flightTime = distance / ballSpeed

        // Lead the receiver more accurately - aim slightly ahead of where they're running
        // Reduced lead factor for better accuracy
        const leadZ = Math.min(targetReceiver.group.position.z + receiverVelocity * flightTime * 0.65, ENDZONE_Z - 1)
        const leadX = targetReceiver.group.position.x

        const targetPos = new BABYLON.Vector3(
          Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, leadX)),
          1.5,
          leadZ,
        )

        ballTargetRef.current = targetPos

        const throwDistance = BABYLON.Vector3.Distance(ballRef.current.position, targetPos)
        const flightDuration = throwDistance / ballSpeed
        const maxHeight = 1.5 + throwDistance * 0.08 // Higher arc for more realistic trajectory

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

    // Handle touchdown
    const handleTouchdown = () => {
      setGameState((prev) => ({
        ...prev,
        score: prev.score + 7,
        message: "TOUCHDOWN!",
      }))
      triggerHaptic("success")
      triggerScreenShake(0.3, 500)
      audioFunctionsRef.current.playTouchdown()
      if (ballRef.current) {
        createCelebrationParticles(ballRef.current.position.clone())
      }
      setTimeout(() => {
        setGameState((prev) => ({ ...prev, message: "" }))
        resetPlay()
      }, 2000)
    }

    // Handle catch
    const handleCatch = () => {
      triggerHaptic("medium")
      setGameState((prev) => ({ ...prev, message: "COMPLETE!" }))
      
      // Check if the catch was in the endzone for a touchdown
      if (ballRef.current && ballRef.current.position.z >= ENDZONE_Z - 3) {
        setTimeout(() => handleTouchdown(), 500)
      } else {
        // Successful catch but not a touchdown - reset for next down
        setTimeout(() => {
          setGameState((prev) => ({
            ...prev,
            downs: 1, // Reset downs on successful completion
            message: "",
          }))
          resetPlay()
        }, 1500)
      }
    }

    // Handle interception
    const handleInterception = () => {
      const newDowns = gameStateRef.current.downs + 1
      if (newDowns > 4) {
        setGameState((prev) => ({ ...prev, gameStatus: "gameover", message: "INTERCEPTED!" }))
      } else {
        setGameState((prev) => ({
          ...prev,
          downs: newDowns,
          message: "INTERCEPTED!",
        }))
        setTimeout(() => {
          setGameState((prev) => ({ ...prev, message: "" }))
          resetPlay()
        }, 1500)
      }
      triggerHaptic("error")
      triggerScreenShake(0.4, 350)
      audioFunctionsRef.current.playSack()
      if (ballRef.current) {
        createCelebrationParticles(ballRef.current.position.clone(), new BABYLON.Color4(1, 0.5, 0, 1))
      }
    }

    // Handle sack
    const handleSack = () => {
      const newDowns = gameStateRef.current.downs + 1
      if (newDowns > 4) {
        setGameState((prev) => ({ ...prev, gameStatus: "gameover", message: "SACKED!" }))
      } else {
        setGameState((prev) => ({
          ...prev,
          downs: newDowns,
          message: "SACKED!",
        }))
        setTimeout(() => {
          setGameState((prev) => ({ ...prev, message: "" }))
          resetPlay()
        }, 1500)
      }
      triggerHaptic("heavy")
      triggerScreenShake(0.5, 400)
      audioFunctionsRef.current.playSack()
      if (qbRef.current) {
        createCelebrationParticles(
          qbRef.current.position.add(new BABYLON.Vector3(0, 1, 0)),
          new BABYLON.Color4(1, 0.3, 0.3, 1),
        )
      }
    }

    // Handle incomplete
    const handleIncomplete = () => {
      const newDowns = gameStateRef.current.downs + 1
      if (newDowns > 4) {
        setGameState((prev) => ({ ...prev, gameStatus: "gameover", message: "INCOMPLETE!" }))
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

      if (pickResult.hit && pickResult.pickedMesh) {
        const hitMesh = pickResult.pickedMesh
        for (const receiver of receiversRef.current) {
          const hitArea = (receiver.group as any).hitArea
          if (hitMesh === hitArea || hitMesh.parent === receiver.group) {
            triggerHaptic("medium")
            throwBall(receiver.data)
            return
          }
        }
      }

      // Proximity-based throw assist - increased radius for easier targeting
      if (pickResult.hit && pickResult.pickedPoint) {
        const tapPoint = pickResult.pickedPoint
        let closestReceiver: (typeof receiversRef.current)[0] | null = null
        let closestDist = 12 // Increased from 8 for easier throw targeting

        for (const receiver of receiversRef.current) {
          const dist = BABYLON.Vector3.Distance(
            new BABYLON.Vector3(tapPoint.x, 0, tapPoint.z),
            new BABYLON.Vector3(receiver.group.position.x, 0, receiver.group.position.z),
          )
          if (dist < closestDist) {
            closestDist = dist
            closestReceiver = receiver
          }
        }

        if (closestReceiver) {
          triggerHaptic("medium")
          throwBall(closestReceiver.data)
        }
      }
    }

    // Game loop
    let lastTime = performance.now()
    let sackTimerAccum = 0

    scene.registerBeforeRender(() => {
      const currentTime = performance.now()
      const delta = (currentTime - lastTime) / 1000
      lastTime = currentTime

      if (gameStateRef.current.gameStatus !== "playing") return

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

      // QB movement
      if (qbRef.current && !ballThrownRef.current) {
        const moveSpeed = 6
        qbRef.current.position.x += joystickRef.current.x * moveSpeed * delta
        qbRef.current.position.z -= joystickRef.current.y * moveSpeed * delta

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
          const isMoving = Math.abs(joystickRef.current.x) > 0.1 || Math.abs(joystickRef.current.y) > 0.1
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
        const startZ = -10 // Line of scrimmage
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

      {gameState.gameStatus === "playing" && <VirtualJoystick onMove={handleJoystickMove} />}

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
