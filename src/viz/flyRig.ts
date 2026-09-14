import * as THREE from 'three'
import type { DjAction } from '../types'

export type FlyRig = {
  group: THREE.Group
  update: (t: number, beat: number, action: DjAction) => void
}

function chitinMat(color: number, emissive = 0x061018, eInt = 0.2): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.38,
    metalness: 0.28,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: eInt,
  })
}

function outlineOf(mesh: THREE.Mesh, color: number, inflate = 1.09): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: true,
    opacity: 1,
  })
  const o = new THREE.Mesh(mesh.geometry, mat)
  o.scale.copy(mesh.scale).multiplyScalar(inflate)
  o.position.copy(mesh.position)
  o.rotation.copy(mesh.rotation)
  return o
}

function glowBall(r: number, color: number, intensity = 1.4): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 14, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(1, intensity) }),
  )
}

type Arm = {
  root: THREE.Group
  knee: THREE.Group
  hand: THREE.Mesh
  trail: THREE.Line
  trailPos: Float32Array
  trailI: number
  side: number
}

export function createFlyRig(): FlyRig {
  const group = new THREE.Group()
  group.name = 'fly-dj'
  const inner = new THREE.Group()
  group.add(inner)

  const body = chitinMat(0x3a3148, 0x3ee0ff, 0.45)
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xf0c15a,
    roughness: 0.28,
    metalness: 0.55,
    emissive: new THREE.Color(0xffb020),
    emissiveIntensity: 0.85,
  })
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff0028,
    roughness: 0.18,
    metalness: 0.02,
    emissive: new THREE.Color(0xff1038),
    emissiveIntensity: 3.4,
  })
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x8ee8ff,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x4fd2ff),
    emissiveIntensity: 1.15,
  })
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a28,
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(0x3a2208),
    emissiveIntensity: 0.55,
  })
  const jointMat = new THREE.MeshStandardMaterial({
    color: 0xe8b84a,
    roughness: 0.35,
    metalness: 0.5,
    emissive: new THREE.Color(0xffaa22),
    emissiveIntensity: 0.7,
  })

  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), body)
  abdomen.scale.set(0.92, 0.78, 1.62)
  abdomen.position.set(0, 0.04, 0.28)
  inner.add(abdomen, outlineOf(abdomen, 0xff4da6, 1.18), outlineOf(abdomen, 0x3ee0ff, 1.1))

  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.175 - i * 0.008, 0.016, 10, 28), gold)
    band.rotation.x = Math.PI / 2
    band.position.set(0, 0.045, 0.14 + i * 0.075)
    inner.add(band)
  }

  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.175, 22, 18), body)
  thorax.scale.set(1.12, 1.0, 1.18)
  thorax.position.set(0, 0.1, -0.02)
  inner.add(thorax, outlineOf(thorax, 0x3ee0ff, 1.2), outlineOf(thorax, 0xff4da6, 1.1))

  const headG = new THREE.Group()
  headG.position.set(0, 0.12, -0.24)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), body)
  head.scale.set(1.2, 0.95, 0.92)
  headG.add(head, outlineOf(head, 0x3ee0ff, 1.18), outlineOf(head, 0xff4da6, 1.08))

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 14), eyeMat)
  eyeL.scale.set(1.35, 1.45, 0.88)
  eyeL.position.set(-0.1, 0.025, -0.08)
  const eyeR = eyeL.clone()
  eyeR.position.x *= -1
  const glintL = glowBall(0.018, 0xffe6ee, 1)
  glintL.position.set(-0.11, 0.045, -0.11)
  const glintR = glintL.clone()
  glintR.position.x *= -1
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.5, emissive: new THREE.Color(0x221510), emissiveIntensity: 0.4 }),
  )
  face.position.set(0, -0.01, -0.1)
  face.scale.set(0.7, 0.7, 0.55)
  headG.add(eyeL, eyeR, glintL, glintR, face)

  const antGeo = new THREE.CylinderGeometry(0.007, 0.012, 0.2, 6)
  const antL = new THREE.Mesh(antGeo, gold)
  antL.position.set(-0.05, 0.16, -0.08)
  antL.rotation.z = 0.55
  antL.rotation.x = -0.55
  const antR = antL.clone()
  antR.position.x *= -1
  antR.rotation.z *= -1
  headG.add(antL, antR)
  inner.add(headG)

  const wingShape = new THREE.Shape()
  wingShape.moveTo(0, 0)
  wingShape.quadraticCurveTo(0.28, 0.26, 0.58, 0.08)
  wingShape.quadraticCurveTo(0.4, -0.12, 0.02, -0.04)
  wingShape.quadraticCurveTo(0.0, -0.01, 0, 0)
  const wingGeo = new THREE.ShapeGeometry(wingShape, 12)
  const wingL = new THREE.Mesh(wingGeo, wingMat)
  wingL.position.set(-0.08, 0.2, -0.02)
  wingL.rotation.y = 0.42
  const wingR = wingL.clone()
  wingR.position.x *= -1
  wingR.rotation.y *= -1
  inner.add(wingL, wingR)

  const hindLegs: THREE.Group[] = []
  for (const side of [-1, 1]) {
    for (let i = 1; i < 3; i++) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.12, -0.02, -0.04 + i * 0.12)
      const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.22, 6), legMat)
      femur.position.y = -0.11
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), jointMat)
      joint.position.y = -0.22
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.007, 0.2, 6), legMat)
      shin.position.set(side * 0.04, -0.32, 0.02)
      shin.rotation.z = side * 0.35
      hip.add(femur, joint, shin)
      hip.rotation.z = side * 0.95
      hip.rotation.x = 0.2 * (i - 1.4)
      inner.add(hip)
      hindLegs.push(hip)
    }
  }

  const makeArm = (side: number, hue: number): Arm => {
    const root = new THREE.Group()
    root.position.set(side * 0.13, 0.04, -0.1)
    const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.26, 7), legMat)
    femur.position.set(0, -0.13, 0)
    const knee = new THREE.Group()
    knee.position.set(0, -0.26, 0)
    const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.28, 7), legMat)
    tibia.position.set(0, -0.14, 0)
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), jointMat)
    const hand = glowBall(0.038, hue, 0.95)
    hand.position.set(0, -0.3, 0)
    const handHalo = new THREE.PointLight(hue, 1.1, 1.6)
    hand.add(handHalo)
    knee.add(tibia, joint, hand)
    root.add(femur, knee)
    inner.add(root)

    const trailPos = new Float32Array(24 * 3)
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: hue, transparent: true, opacity: 0.55 }),
    )
    inner.add(trail)
    return { root, knee, hand, trail, trailPos, trailI: 0, side }
  }

  const armL = makeArm(-1, 0x3ee0ff)
  const armR = makeArm(1, 0xff4da6)

  const keyFill = new THREE.PointLight(0xfff6e8, 3.4, 4.2)
  keyFill.position.set(0.2, 0.45, 0.35)
  const rimC = new THREE.PointLight(0x3ee0ff, 3.6, 3.6)
  rimC.position.set(-0.35, 0.28, -0.4)
  const rimM = new THREE.PointLight(0xff4da6, 3.2, 3.4)
  rimM.position.set(0.35, 0.22, 0.4)
  const belly = new THREE.PointLight(0xffc14a, 1.6, 2.4)
  belly.position.set(0, -0.15, 0.15)
  inner.add(keyFill, rimC, rimM, belly)

  const tmp = new THREE.Vector3()
  const worldHand = new THREE.Vector3()

  const poseArm = (arm: Arm, targetLocal: THREE.Vector3, t: number) => {
    const side = arm.side
    arm.root.rotation.z = side * (0.55 + Math.atan2(targetLocal.y - arm.root.position.y, 0.35) * 0.35)
    arm.root.rotation.x = -0.15 + (targetLocal.z - arm.root.position.z) * 0.55
    arm.root.rotation.y = side * 0.15 + (targetLocal.x - arm.root.position.x) * 0.25
    const reach = clamp01(targetLocal.distanceTo(arm.root.position) / 1.4)
    arm.knee.rotation.x = 0.35 + reach * 0.85 + Math.sin(t * 9 + side) * 0.06
    arm.knee.rotation.z = -side * (0.25 + reach * 0.4)
    arm.hand.getWorldPosition(worldHand)
    inner.worldToLocal(worldHand)
    const i = (arm.trailI % 24) * 3
    arm.trailPos[i] = worldHand.x
    arm.trailPos[i + 1] = worldHand.y
    arm.trailPos[i + 2] = worldHand.z
    arm.trailI++
    ;(arm.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  return {
    group,
    update(t, beat, action) {
      const xf = action.crossfade
      const lean = (xf - 0.5) * 0.95
      const twist = (action.filterB - action.filterA) * 0.55
      const bob = Math.sin(t * 7.2) * 0.03 + beat * 0.1 + action.punch * 0.07
      inner.position.y = bob
      inner.position.x = lean * 0.08
      inner.rotation.y = Math.PI + 0.92 + lean * 0.45
      inner.rotation.z = -lean * 0.4 + Math.sin(t * 3.1) * 0.03
      inner.rotation.x = -0.08 + action.punch * 0.18 + beat * 0.06

      headG.rotation.y = lean * 0.7 + twist * 0.35
      headG.rotation.x = -0.08 + action.punch * 0.35 + beat * 0.2
      antL.rotation.x = -0.55 + Math.sin(t * 11) * 0.12
      antR.rotation.x = -0.55 + Math.cos(t * 10) * 0.12

      const flap = 0.35 + Math.sin(t * (22 + beat * 28 + action.punch * 16)) * (0.4 + action.punch * 0.45)
      wingL.rotation.z = flap
      wingL.rotation.x = -0.35
      wingR.rotation.z = -flap
      wingR.rotation.x = -0.35
      wingMat.emissiveIntensity = 0.7 + beat * 0.9 + action.punch * 0.6
      eyeMat.emissiveIntensity = 1.8 + beat * 1.4 + action.punch * 0.8

      const leftTarget = tmp.set(-0.55 - (1 - xf) * 0.55, -0.28 - action.filterA * 0.12, 0.15 + (0.5 - xf) * 0.35)
      const rightTarget = new THREE.Vector3(0.55 + xf * 0.55, -0.28 - action.filterB * 0.12, 0.15 + (xf - 0.5) * 0.35)
      if (xf < 0.42) {
        leftTarget.set(-0.08 + xf * 0.2, -0.22, 0.42)
      }
      if (xf > 0.58) {
        rightTarget.set(0.08 + (xf - 0.5) * 0.2, -0.22, 0.42)
      }
      poseArm(armL, leftTarget, t)
      poseArm(armR, rightTarget, t)

      for (let i = 0; i < hindLegs.length; i++) {
        hindLegs[i].rotation.x = 0.15 * ((i % 2) - 0.5) + Math.sin(t * 6 + i) * 0.08
      }
    },
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
