import * as THREE from 'three'
import type { DjAction } from '../types'

/** Six legs → six DJ functions. Animated in `update` from `DjAction` + live booth targets. */
export type LegId = 'L1' | 'L2' | 'L3' | 'R1' | 'R2' | 'R3'

export const LEG_TO_ACTION = {
  L1: 'crossfade',
  L2: 'filterA',
  L3: 'lowEq',
  R1: 'filterB',
  R2: 'master',
  R3: 'punch',
} as const satisfies Record<LegId, keyof DjAction>

export const LEG_IDS: LegId[] = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']

export type LegTargets = Partial<Record<LegId, THREE.Vector3>>

export type FlyRig = {
  group: THREE.Group
  update: (t: number, beat: number, action: DjAction, targets?: LegTargets) => void
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _tgt = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _world = new THREE.Vector3()

const LEG_COLOR: Record<LegId, number> = {
  L1: 0xffe08a,
  L2: 0x3ee0ff,
  L3: 0xff9f40,
  R1: 0xff4da6,
  R2: 0x7dffb0,
  R3: 0xff5d4a,
}

type Leg = {
  id: LegId
  hip: THREE.Vector3
  femurLen: number
  tibiaLen: number
  pole: THREE.Vector3
  femur: THREE.Mesh
  tibia: THREE.Mesh
  kneeBall: THREE.Mesh
  hipBall: THREE.Mesh
  tip: THREE.Mesh
  chord: THREE.Line
  chordPos: Float32Array
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

function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  _dir.subVectors(to, from)
  const len = Math.max(_dir.length(), 0.001)
  _mid.copy(from).add(to).multiplyScalar(0.5)
  mesh.position.copy(_mid)
  mesh.quaternion.setFromUnitVectors(Y_AXIS, _dir.multiplyScalar(1 / len))
  mesh.scale.set(1, len, 1)
}

function solveLeg(leg: Leg, targetLocal: THREE.Vector3) {
  _tgt.copy(targetLocal)
  _dir.subVectors(_tgt, leg.hip)
  let dist = _dir.length()
  const maxR = leg.femurLen + leg.tibiaLen - 0.02
  const minR = Math.abs(leg.femurLen - leg.tibiaLen) + 0.05
  if (dist > maxR) {
    _dir.setLength(maxR)
    _tgt.copy(leg.hip).add(_dir)
    dist = maxR
  } else if (dist < minR) {
    if (dist < 1e-5) _dir.set(leg.pole.x, -0.2, 0.4)
    _dir.setLength(minR)
    _tgt.copy(leg.hip).add(_dir)
    dist = minR
  }
  const d1 = (leg.femurLen * leg.femurLen - leg.tibiaLen * leg.tibiaLen + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, leg.femurLen * leg.femurLen - d1 * d1))
  _axis.copy(_dir).normalize()
  _pole.copy(leg.pole)
  _pole.addScaledVector(_axis, -_pole.dot(_axis))
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 1, 0)
  _pole.normalize()
  _knee.copy(leg.hip).addScaledVector(_axis, d1).addScaledVector(_pole, h)
  placeBone(leg.femur, leg.hip, _knee)
  placeBone(leg.tibia, _knee, _tgt)
  leg.kneeBall.position.copy(_knee)
  leg.hipBall.position.copy(leg.hip)
  leg.tip.position.copy(_tgt)
  leg.chordPos[0] = leg.hip.x
  leg.chordPos[1] = leg.hip.y
  leg.chordPos[2] = leg.hip.z
  leg.chordPos[3] = _tgt.x
  leg.chordPos[4] = _tgt.y
  leg.chordPos[5] = _tgt.z
  ;(leg.chord.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
}

/** Local-space reach fallbacks if BoothView has not yet published world targets. +Z = toward desk/camera. */
function fallbackLocal(id: LegId, action: DjAction, out: THREE.Vector3) {
  switch (id) {
    case 'L1':
      return out.set((action.crossfade - 0.5) * 0.42, -0.22, 0.58)
    case 'L2':
      return out.set(-0.5 - action.filterA * 0.08, -0.2, 0.46 + action.filterA * 0.1)
    case 'L3':
      return out.set(-0.34, -0.18, 0.28 + action.lowEq * 0.16)
    case 'R1':
      return out.set(0.5 + action.filterB * 0.08, -0.2, 0.46 + action.filterB * 0.1)
    case 'R2':
      return out.set(0.2, -0.2, 0.34 + action.master * 0.22)
    case 'R3':
      return out.set(0.34, -0.16 + action.punch * 0.08, 0.26)
    default:
      return out.set(0, -0.2, 0.4)
  }
}

export function createFlyRig(): FlyRig {
  const group = new THREE.Group()
  group.name = 'fly-dj'
  const inner = new THREE.Group()
  group.add(inner)

  // Existing mesh is built head-at-−Z. Flip the torso so the face looks toward +Z (audience / camera)
  // without mirroring left/right — L legs stay world −X (deck A).
  const torso = new THREE.Group()
  torso.rotation.y = Math.PI
  inner.add(torso)

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
  const jointMat = new THREE.MeshStandardMaterial({
    color: 0xffd36a,
    roughness: 0.3,
    metalness: 0.45,
    emissive: new THREE.Color(0xffaa22),
    emissiveIntensity: 1.35,
  })

  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), body)
  abdomen.scale.set(0.92, 0.78, 1.62)
  abdomen.position.set(0, 0.04, 0.28)
  torso.add(abdomen, outlineOf(abdomen, 0xff4da6, 1.18), outlineOf(abdomen, 0x3ee0ff, 1.1))

  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.175 - i * 0.008, 0.016, 10, 28), gold)
    band.rotation.x = Math.PI / 2
    band.position.set(0, 0.045, 0.14 + i * 0.075)
    torso.add(band)
  }

  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.175, 22, 18), body)
  thorax.scale.set(1.12, 1.0, 1.18)
  thorax.position.set(0, 0.1, -0.02)
  torso.add(thorax, outlineOf(thorax, 0x3ee0ff, 1.2), outlineOf(thorax, 0xff4da6, 1.1))

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
  torso.add(headG)

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
  torso.add(wingL, wingR)

  const keyFill = new THREE.PointLight(0xfff6e8, 3.4, 4.2)
  keyFill.position.set(0.2, 0.45, 0.35)
  const rimC = new THREE.PointLight(0x3ee0ff, 3.6, 3.6)
  rimC.position.set(-0.35, 0.28, -0.4)
  const rimM = new THREE.PointLight(0xff4da6, 3.2, 3.4)
  rimM.position.set(0.35, 0.22, 0.4)
  const belly = new THREE.PointLight(0xffc14a, 1.6, 2.4)
  belly.position.set(0, -0.15, 0.15)
  inner.add(keyFill, rimC, rimM, belly)

  const specs: { id: LegId; hip: [number, number, number]; femur: number; tibia: number; pole: [number, number, number] }[] = [
    { id: 'L1', hip: [-0.13, 0.03, 0.11], femur: 0.48, tibia: 0.56, pole: [-0.62, 0.52, 0.08] },
    { id: 'L2', hip: [-0.16, 0.01, -0.01], femur: 0.5, tibia: 0.58, pole: [-0.7, 0.48, 0.0] },
    { id: 'L3', hip: [-0.14, 0.0, -0.16], femur: 0.46, tibia: 0.52, pole: [-0.58, 0.44, -0.18] },
    { id: 'R1', hip: [0.13, 0.03, 0.11], femur: 0.48, tibia: 0.56, pole: [0.62, 0.52, 0.08] },
    { id: 'R2', hip: [0.16, 0.01, -0.01], femur: 0.5, tibia: 0.58, pole: [0.7, 0.48, 0.0] },
    { id: 'R3', hip: [0.14, 0.0, -0.16], femur: 0.46, tibia: 0.52, pole: [0.58, 0.44, -0.18] },
  ]

  const legs: Leg[] = specs.map((s) => {
    const hue = LEG_COLOR[s.id]
    const boneMat = new THREE.MeshStandardMaterial({
      color: hue,
      roughness: 0.35,
      metalness: 0.2,
      emissive: new THREE.Color(hue),
      emissiveIntensity: 0.55,
    })
    const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 1, 7), boneMat)
    const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 1, 7), boneMat)
    const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), jointMat)
    const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), jointMat)
    const tip = glowBall(0.06, hue, 1)
    const halo = new THREE.PointLight(hue, 0.85, 1.15)
    tip.add(halo)
    const chordPos = new Float32Array(6)
    const chordGeo = new THREE.BufferGeometry()
    chordGeo.setAttribute('position', new THREE.BufferAttribute(chordPos, 3))
    const chord = new THREE.Line(chordGeo, new THREE.LineBasicMaterial({ color: hue, transparent: true, opacity: 0.85 }))
    inner.add(femur, tibia, kneeBall, hipBall, tip, chord)
    return {
      id: s.id,
      hip: new THREE.Vector3(...s.hip),
      femurLen: s.femur,
      tibiaLen: s.tibia,
      pole: new THREE.Vector3(...s.pole),
      femur,
      tibia,
      kneeBall,
      hipBall,
      tip,
      chord,
      chordPos,
    }
  })

  const restAction: DjAction = {
    crossfade: 0.22,
    filterA: 0.78,
    filterB: 0.34,
    lowEq: 0.7,
    master: 0.64,
    punch: 0.58,
  }
  for (const leg of legs) {
    fallbackLocal(leg.id, restAction, _world)
    solveLeg(leg, _world)
  }

  return {
    group,
    update(t, beat, action, targets) {
      const xf = action.crossfade
      const lean = (xf - 0.5) * 0.95
      const twist = (action.filterB - action.filterA) * 0.55
      const bob = Math.sin(t * 7.2) * 0.012 + beat * 0.035 + action.punch * 0.03
      inner.position.y = bob
      inner.position.x = lean * 0.05
      inner.rotation.y = lean * 0.28
      inner.rotation.z = -lean * 0.22 + Math.sin(t * 3.1) * 0.02
      inner.rotation.x = -0.22 + action.punch * 0.1 + beat * 0.04

      headG.rotation.y = lean * 0.55 + twist * 0.28
      headG.rotation.x = -0.06 + action.punch * 0.28 + beat * 0.16
      antL.rotation.x = -0.55 + Math.sin(t * 11) * 0.12
      antR.rotation.x = -0.55 + Math.cos(t * 10) * 0.12

      const flap = 0.35 + Math.sin(t * (22 + beat * 28 + action.punch * 16)) * (0.4 + action.punch * 0.45)
      wingL.rotation.z = flap
      wingL.rotation.x = -0.35
      wingR.rotation.z = -flap
      wingR.rotation.x = -0.35
      wingMat.emissiveIntensity = 0.7 + beat * 0.9 + action.punch * 0.6
      eyeMat.emissiveIntensity = 1.8 + beat * 1.4 + action.punch * 0.8

      inner.updateWorldMatrix(true, false)

      for (const leg of legs) {
        const world = targets?.[leg.id]
        if (world) {
          _world.copy(world)
          inner.worldToLocal(_world)
        } else {
          fallbackLocal(leg.id, action, _world)
        }
        // Tiny hover so the tarsus sits on the control instead of burying into it.
        _world.y += 0.012
        solveLeg(leg, _world)
        const key = LEG_TO_ACTION[leg.id]
        const glow = 0.55 + action[key] * 0.45 + beat * 0.15
        ;(leg.tip.material as THREE.MeshBasicMaterial).opacity = Math.min(1, glow)
      }
    },
  }
}
