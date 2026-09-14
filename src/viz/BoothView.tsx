import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { AudioFeatures, Callout, DjAction } from '../types'
import { LEG_IDS, createFlyRig, type LegId, type LegTargets } from './flyRig'

type Props = {
  action: DjAction
  features: AudioFeatures | null
  waveform: Uint8Array | null
  playing: boolean
  showcase?: boolean
  showcasePhase?: 'heuristic' | 'trained' | null
  callout?: Callout | null
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = 'rgba(8, 10, 18, 0.78)'
    ctx.beginPath()
    ctx.roundRect(10, 10, 236, 44, 12)
    ctx.fill()
    ctx.font = '700 28px IBM Plex Mono, monospace'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 34)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  spr.scale.set(0.46, 0.115, 1)
  return spr
}

function addTouch(parent: THREE.Object3D, y = 0.05): THREE.Object3D {
  const touch = new THREE.Object3D()
  touch.position.set(0, y, 0)
  parent.add(touch)
  return touch
}

export function BoothView({ action, features, waveform, playing, showcase, showcasePhase, callout }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const api = useRef<{
    action: DjAction
    beat: number
    xf: THREE.Mesh
    platA: THREE.Mesh
    platB: THREE.Mesh
    ringA: THREE.Mesh
    ringB: THREE.Mesh
    filterA: THREE.Group
    filterB: THREE.Group
    low: THREE.Mesh
    master: THREE.Mesh
    punch: THREE.Mesh
    touches: Record<LegId, THREE.Object3D>
  } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch (err) {
      el.textContent = `WebGL 不可用 / WebGL unavailable: ${err instanceof Error ? err.message : String(err)}`
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.42
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, el.clientWidth / el.clientHeight, 0.1, 80)
    // Three-quarter front: audience-right, desk between camera and fly.
    camera.position.set(2.55, 2.05, 3.35)
    camera.lookAt(0.04, 0.78, -0.18)

    scene.background = new THREE.Color(0x22182c)
    scene.add(new THREE.AmbientLight(0xd0d8f0, 1.35))
    const key = new THREE.SpotLight(0xfff0d8, 14, 22, 0.62, 0.28, 1)
    key.position.set(2.6, 4.4, 3.4)
    const fill = new THREE.PointLight(0x66f4ff, 8.5, 16)
    fill.position.set(-2.2, 2.4, 2.4)
    const rim = new THREE.PointLight(0xff4da6, 7.2, 14)
    rim.position.set(-0.4, 1.6, -2.2)
    const bounce = new THREE.PointLight(0xffc14a, 3.4, 8)
    bounce.position.set(0, 0.3, 0.8)
    const faceKey = new THREE.PointLight(0xfff3d0, 4.2, 6)
    faceKey.position.set(0.35, 1.35, 1.1)
    scene.add(key, fill, rim, bounce, faceKey)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x16101c, roughness: 0.48, metalness: 0.35, emissive: new THREE.Color(0x120818), emissiveIntensity: 0.4 }),
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.07, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x1a1424, roughness: 0.55, metalness: 0.25, emissive: new THREE.Color(0x2a1838), emissiveIntensity: 0.3 }),
    )
    riser.position.set(0.04, 0.035, -1.12)
    scene.add(riser)

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(4.55, 0.16, 1.68),
      new THREE.MeshPhysicalMaterial({
        color: 0x1c2230,
        roughness: 0.22,
        metalness: 0.72,
        clearcoat: 0.45,
        emissive: new THREE.Color(0x102030),
        emissiveIntensity: 0.25,
      }),
    )
    desk.position.set(0, 0.42, 0.28)
    scene.add(desk)

    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(4.55, 0.42, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.4, metalness: 0.45, emissive: new THREE.Color(0x1a2840), emissiveIntensity: 0.35 }),
    )
    fascia.position.set(0, 0.21, 1.08)
    scene.add(fascia)

    const deckMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a2230,
      roughness: 0.24,
      metalness: 0.7,
      emissive: new THREE.Color(0x1a4a66),
      emissiveIntensity: 0.75,
    })
    const deckA = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.1, 1.02), deckMat)
    deckA.position.set(-1.52, 0.55, 0.34)
    const deckB = deckA.clone()
    deckB.position.x = 1.52
    ;(deckB.material as THREE.MeshPhysicalMaterial).emissive = new THREE.Color(0x661a44)
    scene.add(deckA, deckB)

    const platterMat = new THREE.MeshStandardMaterial({
      color: 0x1a2430,
      roughness: 0.18,
      metalness: 0.88,
      emissive: new THREE.Color(0x2ad4ff),
      emissiveIntensity: 1.15,
    })
    const platA = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.045, 48), platterMat)
    platA.position.set(-1.52, 0.62, 0.3)
    const platB = platA.clone()
    platB.position.x = 1.52
    const platBMat = (platB.material as THREE.MeshStandardMaterial).clone()
    platBMat.emissive = new THREE.Color(0xff4da6)
    platB.material = platBMat
    scene.add(platA, platB)

    const ringA = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.016, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0x3ee0ff }),
    )
    ringA.rotation.x = Math.PI / 2
    ringA.position.copy(platA.position)
    ringA.position.y += 0.03
    const ringB = ringA.clone()
    ringB.material = (ringA.material as THREE.MeshBasicMaterial).clone()
    ;(ringB.material as THREE.MeshBasicMaterial).color.set(0xff4da6)
    ringB.position.copy(platB.position)
    ringB.position.y += 0.03
    scene.add(ringA, ringB)

    const mixer = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.09, 1.02),
      new THREE.MeshPhysicalMaterial({
        color: 0x161820,
        metalness: 0.82,
        roughness: 0.22,
        emissive: new THREE.Color(0x243040),
        emissiveIntensity: 0.35,
      }),
    )
    mixer.position.set(0, 0.55, 0.02)
    scene.add(mixer)

    const xfRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.025, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x2a2430, metalness: 0.6, roughness: 0.3 }),
    )
    xfRail.position.set(0, 0.6, -0.02)
    scene.add(xfRail)
    const xf = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.09, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: new THREE.Color(0xffc14a), emissiveIntensity: 1.3 }),
    )
    xf.position.set(0, 0.66, -0.02)
    scene.add(xf)
    const xfTouch = addTouch(xf, 0.06)
    const xfLab = makeLabel('L1 XF', '#ffe08a')
    xfLab.position.set(0, 0.86, -0.02)
    scene.add(xfLab)

    const makeFilter = (x: number, color: number, title: string) => {
      const g = new THREE.Group()
      g.position.set(x, 0.64, 0.2)
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.08, 0.07, 20),
        new THREE.MeshStandardMaterial({ color: 0x222830, metalness: 0.7, roughness: 0.28, emissive: new THREE.Color(color), emissiveIntensity: 0.55 }),
      )
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 10),
        new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 1.4 }),
      )
      bead.position.set(0.07, 0.04, 0)
      const touch = addTouch(bead, 0.02)
      g.add(knob, bead)
      const lab = makeLabel(title, `#${color.toString(16).padStart(6, '0')}`)
      lab.position.set(0, 0.2, 0)
      g.add(lab)
      scene.add(g)
      return { g, bead, touch }
    }
    const filterA = makeFilter(-1.08, 0x3ee0ff, 'L2 FLT A')
    const filterB = makeFilter(1.08, 0xff4da6, 'R1 FLT B')

    const lowRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.02, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2a2430, metalness: 0.55, roughness: 0.32 }),
    )
    lowRail.position.set(-0.46, 0.6, -0.2)
    scene.add(lowRail)
    const low = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xff9f40, emissive: new THREE.Color(0xff7a18), emissiveIntensity: 1.15 }),
    )
    low.position.set(-0.46, 0.66, -0.2)
    scene.add(low)
    const lowTouch = addTouch(low, 0.05)
    const lowLab = makeLabel('L3 LOW', '#ff9f40')
    lowLab.position.set(-0.46, 0.86, -0.2)
    scene.add(lowLab)

    const masterRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.02, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a2430, metalness: 0.55, roughness: 0.32 }),
    )
    masterRail.position.set(0.34, 0.6, -0.08)
    scene.add(masterRail)
    const master = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x7dffb0, emissive: new THREE.Color(0x2ee88a), emissiveIntensity: 1.1 }),
    )
    master.position.set(0.34, 0.66, -0.08)
    scene.add(master)
    const masterTouch = addTouch(master, 0.05)
    const mstLab = makeLabel('R2 MST', '#7dffb0')
    mstLab.position.set(0.34, 0.86, -0.08)
    scene.add(mstLab)

    const punch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.07, 20),
      new THREE.MeshStandardMaterial({ color: 0xff5d4a, emissive: new THREE.Color(0xff2a20), emissiveIntensity: 1.2 }),
    )
    punch.position.set(0.72, 0.64, -0.22)
    scene.add(punch)
    const punchTouch = addTouch(punch, 0.05)
    const punchLab = makeLabel('R3 PUNCH', '#ff5d4a')
    punchLab.position.set(0.72, 0.86, -0.22)
    scene.add(punchLab)

    const aLab = makeLabel('A', '#3ee0ff')
    aLab.position.set(-1.52, 0.78, 0.3)
    const bLab = makeLabel('B', '#ff4da6')
    bLab.position.set(1.52, 0.78, 0.3)
    scene.add(aLab, bLab)

    const booth = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 2.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a1224, roughness: 0.7, emissive: new THREE.Color(0x2a1040), emissiveIntensity: 0.25 }),
    )
    booth.position.set(0, 1.4, -1.68)
    scene.add(booth)

    const neon = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.025, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x3ee0ff }),
    )
    neon.rotation.x = Math.PI / 2
    neon.position.y = 0.03
    scene.add(neon)

    const fly = createFlyRig()
    // Body behind the desk (more −Z than platters). Feet on the riser, tips reach +Z onto controls.
    fly.group.position.set(0.05, 0.86, -1.08)
    fly.group.scale.setScalar(2.16)
    scene.add(fly.group)

    const targets: LegTargets = {
      L1: new THREE.Vector3(),
      L2: new THREE.Vector3(),
      L3: new THREE.Vector3(),
      R1: new THREE.Vector3(),
      R2: new THREE.Vector3(),
      R3: new THREE.Vector3(),
    }
    const touches: Record<LegId, THREE.Object3D> = {
      L1: xfTouch,
      L2: filterA.touch,
      L3: lowTouch,
      R1: filterB.touch,
      R2: masterTouch,
      R3: punchTouch,
    }

    let t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      const st = api.current
      const act = st?.action ?? { crossfade: 0.5, filterA: 0.5, filterB: 0.5, lowEq: 0.5, master: 0.5, punch: 0 }
      const beat = st?.beat ?? 0
      platA.rotation.y += 0.09 + act.filterA * 0.05
      platB.rotation.y -= 0.09 + act.filterB * 0.05
      xf.position.x = (act.crossfade - 0.5) * 0.5
      xfLab.position.x = xf.position.x
      ringA.scale.setScalar(1 + act.filterA * 0.08 + beat * 0.04)
      ringB.scale.setScalar(1 + act.filterB * 0.08 + beat * 0.04)

      const aAng = act.filterA * Math.PI * 1.6
      filterA.bead.position.set(Math.cos(aAng) * 0.075, 0.045, Math.sin(aAng) * 0.075)
      const bAng = act.filterB * Math.PI * 1.6
      filterB.bead.position.set(Math.cos(bAng) * 0.075, 0.045, Math.sin(bAng) * 0.075)
      low.position.z = -0.3 + act.lowEq * 0.2
      lowLab.position.z = low.position.z
      master.position.z = -0.2 + act.master * 0.24
      mstLab.position.z = master.position.z
      punch.position.y = 0.62 + act.punch * 0.1
      punchLab.position.y = punch.position.y + 0.22
      ;(punch.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + act.punch * 1.4

      for (const id of LEG_IDS) {
        touches[id].getWorldPosition(targets[id]!)
      }
      fly.update(t, beat, act, targets)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onResize = () => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    api.current = {
      action,
      beat: 0,
      xf,
      platA,
      platB,
      ringA,
      ringB,
      filterA: filterA.g,
      filterB: filterB.g,
      low,
      master,
      punch,
      touches,
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      api.current = null
    }
  }, [])

  useEffect(() => {
    if (api.current) {
      api.current.action = action
      api.current.beat = features?.beat ?? 0
    }
  }, [action, features])

  useEffect(() => {
    const cvs = waveRef.current
    if (!cvs || !waveform) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const { width: w, height: h } = cvs
    ctx.fillStyle = '#0c0e16'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#3ee0ff'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / waveform.length) * w
      const y = (waveform[i] / 255) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,77,166,0.5)'
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
  }, [waveform])

  const phaseLabel =
    showcasePhase === 'heuristic' ? '对照 · 启发式 / Heuristic 8s' : showcasePhase === 'trained' ? '训练后打碟 / Trained DJ' : null

  return (
    <div className="panel booth">
      <header className="panel-head">
        <div>
          <p className="kicker">Booth · 果蝇打碟</p>
          <h2>DJ 台 / Fly behind the decks</h2>
        </div>
        <span className={`live-dot ${playing ? 'on' : ''}`}>{playing ? 'ON AIR' : 'STANDBY'}</span>
      </header>
      <div className="canvas-host booth-canvas" ref={wrap}>
        {showcase && (
          <div className="showcase-banner">
            <b>展示打碟 / SHOWCASE</b>
            {phaseLabel && <em>{phaseLabel}</em>}
          </div>
        )}
        {callout && (
          <div className="dj-callout">
            <strong>{callout.zh}</strong>
            <span>{callout.en}</span>
          </div>
        )}
        <div className="leg-legend" translate="no">
          <span>L1 交叉 XF</span>
          <span>L2 滤波 A</span>
          <span>L3 低频 LOW</span>
          <span>R1 滤波 B</span>
          <span>R2 主音量 MST</span>
          <span>R3 冲击 PUNCH</span>
        </div>
      </div>
      <div className="booth-meters">
        <canvas ref={waveRef} width={520} height={72} className="scope" />
        <FaderBank action={action} />
      </div>
    </div>
  )
}

function FaderBank({ action }: { action: DjAction }) {
  const rows: { key: keyof DjAction; en: string; zh: string }[] = [
    { key: 'crossfade', en: 'L1 XF', zh: '交叉' },
    { key: 'filterA', en: 'L2 FLT A', zh: '滤波 A' },
    { key: 'filterB', en: 'R1 FLT B', zh: '滤波 B' },
    { key: 'lowEq', en: 'L3 LOW', zh: '低频' },
    { key: 'master', en: 'R2 MST', zh: '主音量' },
    { key: 'punch', en: 'R3 PUNCH', zh: '冲击' },
  ]
  return (
    <div className="faders">
      {rows.map((r) => (
        <label key={r.key}>
          <span>
            {r.zh} <em>{r.en}</em>
          </span>
          <i>
            <b style={{ height: `${Math.round(action[r.key] * 100)}%` }} />
          </i>
          <small>{action[r.key].toFixed(2)}</small>
        </label>
      ))}
    </div>
  )
}
