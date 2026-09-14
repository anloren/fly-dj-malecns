import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Manifest, NodeData, TypeBook } from '../types'
import { POOL_COLOR, toScene } from './coords'

type Props = {
  nodes: NodeData
  types: TypeBook
  manifest: Manifest
  vizIndex: Uint32Array
  vizRates: Float32Array | null
  raster: Uint8Array | null
  rasterRates: Float32Array | null
  topK: { name: string; rate: number }[]
  meanRate: number
  rateStd?: number
}

export function ConnectomeView({
  nodes,
  types,
  manifest,
  vizIndex,
  vizRates,
  raster,
  rasterRates,
  topK,
  meanRate,
  rateStd = 0,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const api = useRef<{
    colors: Float32Array
    colorAttr: THREE.BufferAttribute
    rates: Float32Array | null
    meanRate: number
    amb: THREE.AmbientLight
    controls: OrbitControls
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
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070814)
    scene.fog = new THREE.FogExp2(0x070814, 0.008)
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 200)
    camera.position.set(22, 8, 32)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.55
    controls.maxDistance = 80
    controls.minDistance = 8

    const amb = new THREE.AmbientLight(0x9ab4ff, 0.7)
    scene.add(amb)
    const a = new THREE.PointLight(0x3ee0ff, 3.4, 90)
    a.position.set(12, 18, 8)
    const b = new THREE.PointLight(0xff4d9a, 2.4, 80)
    b.position.set(-14, -6, 10)
    const c = new THREE.PointLight(0xffc14a, 1.8, 60)
    c.position.set(0, -16, 4)
    scene.add(a, b, c)

    const loader = new GLTFLoader()
    const shells: { url: string; color: number; opacity: number }[] = [
      { url: '/data/shells/cb.glb', color: 0x7ec8ff, opacity: 0.13 },
      { url: '/data/shells/ol_l.glb', color: 0x5dffc8, opacity: 0.16 },
      { url: '/data/shells/ol_r.glb', color: 0x5dffc8, opacity: 0.16 },
      { url: '/data/shells/vnc.glb', color: 0xff9ad6, opacity: 0.12 },
    ]
    for (const s of shells) {
      loader.load(s.url, (gltf) => {
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh) return
          const geo = mesh.geometry.clone()
          const pos = geo.getAttribute('position')
          for (let i = 0; i < pos.count; i++) {
            const [x, y, z] = toScene(pos.getX(i), pos.getY(i), pos.getZ(i))
            pos.setXYZ(i, x, y, z)
          }
          pos.needsUpdate = true
          geo.computeVertexNormals()
          mesh.geometry = geo
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: s.color,
            transparent: true,
            opacity: Math.min(0.28, s.opacity + 0.1),
            roughness: 0.22,
            metalness: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false,
            emissive: new THREE.Color(s.color),
            emissiveIntensity: 0.28,
            wireframe: false,
          })
          const wire = new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({
              color: s.color,
              transparent: true,
              opacity: 0.09,
              wireframe: true,
            }),
          )
          scene.add(mesh)
          scene.add(wire)
        })
      })
    }

    const nViz = vizIndex.length
    const positions = new Float32Array(nViz * 3)
    const colors = new Float32Array(nViz * 3)
    const sizes = new Float32Array(nViz)
    const baseCol = new Float32Array(nViz * 3)
    for (let i = 0; i < nViz; i++) {
      const ni = vizIndex[i]
      const [x, y, z] = toScene(nodes.pos[ni * 3] * 8, nodes.pos[ni * 3 + 1] * 8, nodes.pos[ni * 3 + 2] * 8)
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      const pool = types.pools[nodes.poolIds[ni]] ?? 'other'
      const hex = POOL_COLOR[pool] ?? 0x8899aa
      const col = new THREE.Color(hex)
      baseCol[i * 3] = col.r
      baseCol[i * 3 + 1] = col.g
      baseCol[i * 3 + 2] = col.b
      colors[i * 3] = col.r * 0.55
      colors[i * 3 + 1] = col.g * 0.55
      colors[i * 3 + 2] = col.b * 0.55
      sizes[i] = nodes.hasSoma[ni] ? 1.35 : 0.85
    }
    const pgeo = new THREE.BufferGeometry()
    pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const colorAttr = new THREE.BufferAttribute(colors, 3)
    pgeo.setAttribute('color', colorAttr)
    pgeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    const pts = new THREE.Points(
      pgeo,
      new THREE.PointsMaterial({
        size: 0.16,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    scene.add(pts)
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    for (let i = 0; i < nViz; i++) {
      xs.push(positions[i * 3])
      ys.push(positions[i * 3 + 1])
      zs.push(positions[i * 3 + 2])
    }
    const pct = (arr: number[], p: number) => {
      const s = arr.slice().sort((a, b) => a - b)
      return s[Math.floor((s.length - 1) * p)]
    }
    const cx = (pct(xs, 0.12) + pct(xs, 0.88)) / 2
    const cy = (pct(ys, 0.12) + pct(ys, 0.88)) / 2
    const cz = (pct(zs, 0.12) + pct(zs, 0.88)) / 2
    const rx = Math.max(8, (pct(xs, 0.88) - pct(xs, 0.12)) * 0.7)
    controls.target.set(cx, cy, cz)
    camera.position.set(cx + rx * 0.15, cy + rx * 0.12, cz + rx * 1.55)
    camera.lookAt(cx, cy, cz)

    const pathGroup = new THREE.Group()
    for (const pw of manifest.pathways.slice(0, 22)) {
      const a = manifest.typeCentroids.find((t) => t.id === pw.pre)
      const b = manifest.typeCentroids.find((t) => t.id === pw.post)
      if (!a || !b) continue
      const p0 = new THREE.Vector3(...toScene(a.xyz[0] * 8, a.xyz[1] * 8, a.xyz[2] * 8))
      const p2 = new THREE.Vector3(...toScene(b.xyz[0] * 8, b.xyz[1] * 8, b.xyz[2] * 8))
      const mid = p0.clone().add(p2).multiplyScalar(0.5)
      mid.y += p0.distanceTo(p2) * 0.18
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2)
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 18, 0.035 + Math.log10(pw.weight) * 0.012, 5, false),
        new THREE.MeshBasicMaterial({
          color: POOL_COLOR[a.pool] ?? 0x66ccff,
          transparent: true,
          opacity: 0.22,
        }),
      )
      pathGroup.add(tube)
    }
    scene.add(pathGroup)

    let raf = 0
    const heatRank = new Float32Array(nViz)
    const tick = () => {
      const rates = api.current?.rates
      const pulse = 0.55 + Math.min(1.2, (api.current?.meanRate ?? 0) * 0.35)
      if (api.current) {
        api.current.amb.intensity = 0.55 + pulse * 0.35
        api.current.controls.autoRotateSpeed = 0.32 + pulse * 0.28
      }
      if (rates && rates.length === nViz) {
        percentileRanks(rates, heatRank)
        for (let i = 0; i < nViz; i++) {
          const heat = Math.pow(heatRank[i], 0.62)
          colors[i * 3] = baseCol[i * 3] * (0.12 + heat * 1.55) + heat * 0.55
          colors[i * 3 + 1] = baseCol[i * 3 + 1] * (0.12 + heat * 1.25) + heat * 0.72
          colors[i * 3 + 2] = baseCol[i * 3 + 2] * (0.16 + heat * 1.4) + heat * 1.05
        }
        colorAttr.needsUpdate = true
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onResize = () => {
      if (!el) return
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    api.current = { colors, colorAttr, rates: null, meanRate: 0, amb, controls }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      pgeo.dispose()
      renderer.domElement.remove()
      api.current = null
    }
  }, [nodes, types, manifest, vizIndex])

  useEffect(() => {
    if (api.current) {
      api.current.rates = vizRates
      api.current.meanRate = meanRate
    }
  }, [vizRates, meanRate])

  return (
    <div className="panel connectome">
      <header className="panel-head">
        <div>
          <p className="kicker">MaleCNS v1.0 · frozen CSR</p>
          <h2>连接组现场 / Live connectome</h2>
        </div>
        <div className="hud-pills">
          <span>
            {manifest.nNodes.toLocaleString()} <em>nodes</em>
          </span>
          <span>
            {(manifest.nEdges / 1e6).toFixed(2)}M <em>edges</em>
          </span>
          <span>
            {manifest.nTypes.toLocaleString()} <em>types</em>
          </span>
          <span>
            {meanRate < 0.001 ? '…' : meanRate.toFixed(3)} <em>mean</em>
          </span>
          <span>
            {rateStd.toFixed(3)} <em>σ</em>
          </span>
        </div>
      </header>
      <div className="canvas-host" ref={wrap} />
      <div className="connectome-footer">
        <RasterStrip raster={raster} rasterRates={rasterRates} />
        <TopRates topK={topK} meanRate={meanRate} rateStd={rateStd} />
      </div>
    </div>
  )
}

function percentileRanks(rates: Float32Array, out: Float32Array): void {
  const n = rates.length
  if (!n) return
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((a, b) => rates[a] - rates[b])
  for (let rank = 0; rank < n; rank++) {
    out[idx[rank]] = n === 1 ? 0.5 : rank / (n - 1)
  }
}

function TopRates({
  topK,
  meanRate,
  rateStd,
}: {
  topK: { name: string; rate: number }[]
  meanRate: number
  rateStd: number
}) {
  if (topK.length === 0) return <ol className="topk"><li className="muted">等待放电 / awaiting spikes…</li></ol>
  const rates = topK.map((t) => t.rate)
  const span = Math.max(...rates) - Math.min(...rates)
  const sat = span < 0.02
  return (
    <ol className="topk">
      {topK.slice(0, 6).map((t) => {
        const z = rateStd > 1e-4 ? (t.rate - meanRate) / rateStd : t.rate - meanRate
        const delta = t.rate - meanRate
        return (
          <li key={t.name}>
            <b>{t.name}</b>
            <i>
              {sat ? 'sat' : t.rate.toFixed(2)}{' '}
              <em>
                Δ{delta >= 0 ? '+' : ''}
                {delta.toFixed(3)} z{z.toFixed(2)}
              </em>
            </i>
          </li>
        )
      })}
    </ol>
  )
}

function RasterStrip({ raster, rasterRates }: { raster: Uint8Array | null; rasterRates: Float32Array | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const hist = useRef<Uint8Array[]>([])
  const rateHist = useRef<Float32Array[]>([])

  useEffect(() => {
    if (!raster) return
    const rows = hist.current
    rows.push(raster.slice())
    if (rows.length > 72) rows.shift()
    if (rasterRates) {
      rateHist.current.push(rasterRates.slice())
      if (rateHist.current.length > 72) rateHist.current.shift()
    }
    const cvs = ref.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const w = cvs.width
    const h = cvs.height
    ctx.fillStyle = '#07080f'
    ctx.fillRect(0, 0, w, h)
    const n = rows[0]?.length ?? 0
    if (!n) return
    const latest = rateHist.current[rateHist.current.length - 1]
    let lo = Infinity
    let hi = -Infinity
    if (latest) {
      for (let i = 0; i < latest.length; i++) {
        lo = Math.min(lo, latest[i])
        hi = Math.max(hi, latest[i])
      }
    }
    if (!Number.isFinite(lo) || hi - lo < 1e-4) {
      lo = 0
      hi = 1
    }
    const left = 36
    const plotW = w - left - 8
    for (let t = 0; t < rows.length; t++) {
      const col = rows[t]
      const rr = rateHist.current[t]
      for (let i = 0; i < n; i++) {
        const heat = rr ? (rr[i] - lo) / (hi - lo) : col[i] ? 1 : 0.08
        const spike = col[i] ? 1 : 0
        const l = 22 + heat * 48 + spike * 18
        ctx.fillStyle = `hsla(${200 - heat * 70}, 100%, ${l}%, ${0.35 + heat * 0.55 + spike * 0.3})`
        ctx.fillRect(left + (t / 72) * plotW, (i / n) * (h - 14), Math.max(2, plotW / 72), Math.max(1, (h - 14) / n))
      }
    }
    ctx.fillStyle = '#8b93ad'
    ctx.font = '9px "IBM Plex Mono", monospace'
    ctx.fillText(hi.toFixed(2), 2, 10)
    ctx.fillText(lo.toFixed(2), 2, h - 16)
    ctx.fillText(hi - lo < 0.02 ? 'sat' : 'rate', 2, h - 4)
    for (let i = 0; i < 8; i++) {
      const t = i / 7
      ctx.fillStyle = `hsla(${200 - t * 70}, 100%, ${22 + t * 48}%, 1)`
      ctx.fillRect(left + i * ((plotW - 2) / 8), h - 10, plotW / 8 - 1, 6)
    }
  }, [raster, rasterRates])

  return (
    <div className="raster">
      <p>Raster · 抽样神经元 / rate colorbar</p>
      <canvas ref={ref} width={320} height={100} />
    </div>
  )
}
