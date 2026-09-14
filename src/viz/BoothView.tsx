import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { AudioFeatures, Callout, DjAction } from '../types'
import { createFlyRig } from './flyRig'

type Props = {
  action: DjAction
  features: AudioFeatures | null
  waveform: Uint8Array | null
  playing: boolean
  showcase?: boolean
  showcasePhase?: 'heuristic' | 'trained' | null
  callout?: Callout | null
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
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / el.clientHeight, 0.1, 80)
    camera.position.set(1.55, 1.85, 3.55)
    camera.lookAt(0.05, 1.02, 0.22)

    scene.background = new THREE.Color(0x22182c)
    scene.add(new THREE.AmbientLight(0xd0d8f0, 1.35))
    const key = new THREE.SpotLight(0xfff0d8, 14, 22, 0.62, 0.28, 1)
    key.position.set(2.4, 4.6, 3.2)
    const fill = new THREE.PointLight(0x66f4ff, 8.5, 16)
    fill.position.set(-2.2, 2.4, 2.4)
    const rim = new THREE.PointLight(0xff4da6, 7.2, 14)
    rim.position.set(-0.4, 1.6, -2.0)
    const bounce = new THREE.PointLight(0xffc14a, 3.4, 8)
    bounce.position.set(0, 0.3, 0.8)
    scene.add(key, fill, rim, bounce)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x16101c, roughness: 0.48, metalness: 0.35, emissive: new THREE.Color(0x120818), emissiveIntensity: 0.4 }),
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 0.18, 1.8),
      new THREE.MeshPhysicalMaterial({
        color: 0x1c2230,
        roughness: 0.22,
        metalness: 0.72,
        clearcoat: 0.45,
        emissive: new THREE.Color(0x102030),
        emissiveIntensity: 0.25,
      }),
    )
    desk.position.set(0, 0.35, 0.15)
    scene.add(desk)

    const deckMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a2230,
      roughness: 0.24,
      metalness: 0.7,
      emissive: new THREE.Color(0x1a4a66),
      emissiveIntensity: 0.75,
    })
    const deckA = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.05), deckMat)
    deckA.position.set(-1.45, 0.5, -0.08)
    const deckB = deckA.clone()
    deckB.position.x = 1.45
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
    platA.position.set(-1.45, 0.58, -0.12)
    const platB = platA.clone()
    platB.position.x = 1.45
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
      new THREE.BoxGeometry(0.78, 0.1, 1.08),
      new THREE.MeshPhysicalMaterial({
        color: 0x161820,
        metalness: 0.82,
        roughness: 0.22,
        emissive: new THREE.Color(0x243040),
        emissiveIntensity: 0.35,
      }),
    )
    mixer.position.set(0, 0.5, 0.12)
    scene.add(mixer)

    const xf = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.1, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: new THREE.Color(0xffc14a), emissiveIntensity: 1.3 }),
    )
    xf.position.set(0, 0.6, 0.32)
    scene.add(xf)

    const booth = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 2.4, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a1224, roughness: 0.7, emissive: new THREE.Color(0x2a1040), emissiveIntensity: 0.25 }),
    )
    booth.position.set(0, 1.4, -1.05)
    scene.add(booth)

    const neon = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.025, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x3ee0ff }),
    )
    neon.rotation.x = Math.PI / 2
    neon.position.y = 0.03
    scene.add(neon)

    const fly = createFlyRig()
    fly.group.position.set(0.0, 1.02, 0.32)
    fly.group.scale.setScalar(1.72)
    scene.add(fly.group)

    let t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      const st = api.current
      const act = st?.action ?? { crossfade: 0.5, filterA: 0.5, filterB: 0.5, lowEq: 0.5, master: 0.5, punch: 0 }
      const beat = st?.beat ?? 0
      platA.rotation.y += 0.09 + act.filterA * 0.05
      platB.rotation.y -= 0.09 + act.filterB * 0.05
      xf.position.x = (act.crossfade - 0.5) * 0.48
      ringA.scale.setScalar(1 + act.filterA * 0.08 + beat * 0.04)
      ringB.scale.setScalar(1 + act.filterB * 0.08 + beat * 0.04)
      fly.update(t, beat, act)
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
    api.current = { action, beat: 0, xf, platA, platB, ringA, ringB }

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
          <h2>DJ 台 / Fly at the decks</h2>
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
    { key: 'crossfade', en: 'XF', zh: '交叉' },
    { key: 'filterA', en: 'FLT A', zh: '滤波 A' },
    { key: 'filterB', en: 'FLT B', zh: '滤波 B' },
    { key: 'lowEq', en: 'LOW', zh: '低频' },
    { key: 'master', en: 'MST', zh: '主音量' },
    { key: 'punch', en: 'PUNCH', zh: '冲击' },
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
