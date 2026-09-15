/// <reference lib="webworker" />

const MAGIC = 'FLYDJCSR'

type InitMsg = {
  type: 'init'
  csrUrl: string
  poolIds: Uint8Array
  typeIds: Uint16Array
  nPools: number
  vizIndex: Uint32Array
  rasterIndex: Uint32Array
  typeNames: string[]
}

type StepMsg = {
  type: 'step'
  inject: Float32Array
  /** Optional second sensory inject (video motive); summed with audio inject. */
  videoInject?: Float32Array
  gains: Float32Array
  steps: number
  dt: number
}

type Incoming = InitMsg | StepMsg | { type: 'ping' }

let n = 0
let nnz = 0
let rowPtr: Uint32Array | null = null
let colIdx: Uint32Array | null = null
let weight: Float32Array | null = null
let V: Float32Array | null = null
let rate: Float32Array | null = null
let refrac: Uint8Array | null = null
let spiked: Uint8Array | null = null
let I: Float32Array | null = null
let poolIds: Uint8Array | null = null
let typeIds: Uint16Array | null = null
let nPools = 0
let vizIndex: Uint32Array | null = null
let rasterIndex: Uint32Array | null = null
let typeNames: string[] = []
let typeCount: Uint32Array | null = null
let typeSum: Float32Array | null = null
let WSCALE = 0.018
let ready = false

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf)
  if (u.length >= 8 && u[0] === 0x46 && u[1] === 0x4c && u[2] === 0x59) return buf // FLYDJCSR
  if (!(u[0] === 0x1f && u[1] === 0x8b)) return buf
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

function parseCsr(buf: ArrayBuffer): void {
  const u8 = new Uint8Array(buf)
  const mag = new TextDecoder().decode(u8.subarray(0, 8))
  if (mag !== MAGIC) throw new Error(`bad CSR magic ${mag}`)
  const view = new DataView(buf)
  const version = view.getUint32(8, true)
  if (version !== 1) throw new Error(`unsupported CSR version ${version}`)
  n = view.getUint32(12, true)
  nnz = Number(view.getBigUint64(16, true))
  let off = 24
  rowPtr = new Uint32Array(buf, off, n + 1)
  off += (n + 1) * 4
  colIdx = new Uint32Array(buf, off, nnz)
  off += nnz * 4
  weight = new Float32Array(buf, off, nnz)
  V = new Float32Array(n)
  rate = new Float32Array(n)
  refrac = new Uint8Array(n)
  spiked = new Uint8Array(n)
  I = new Float32Array(n)
}

function stepOnce(inject: Float32Array, gains: Float32Array, dt: number): number {
  if (!rowPtr || !colIdx || !weight || !V || !rate || !refrac || !spiked || !I || !poolIds) return 0
  I.fill(0)
  const decay = Math.exp(-dt / 0.045)
  let nSpikes = 0

  for (let pre = 0; pre < n; pre++) {
    if (!spiked[pre]) continue
    const g = gains[poolIds[pre]] ?? 1
    const a = rowPtr[pre]
    const b = rowPtr[pre + 1]
    const scale = WSCALE * g
    for (let k = a; k < b; k++) {
      I[colIdx[k]] += weight[k] * scale
    }
  }

  spiked.fill(0)
  const tau = 0.02
  const leak = dt / tau
  for (let i = 0; i < n; i++) {
    if (refrac[i] > 0) {
      refrac[i]--
      V[i] *= 0.4
      rate[i] *= decay
      continue
    }
    const ext = (inject[poolIds[i]] ?? 0) + 0.22
    const noise = (Math.random() - 0.28) * 0.72
    const drive = I[i] + ext + 0.58 + noise
    V[i] += leak * (-V[i] + drive)
    rate[i] *= decay
    if (V[i] >= 0.92) {
      V[i] = 0
      refrac[i] = 2
      spiked[i] = 1
      rate[i] += 1
      nSpikes++
    }
  }
  return nSpikes
}

function readout(): {
  poolRates: Float32Array
  topK: { id: number; name: string; rate: number }[]
  vizRates: Float32Array
  raster: Uint8Array
  rasterRates: Float32Array
  meanRate: number
  rateStd: number
} {
  const pools = new Float32Array(nPools)
  const poolN = new Uint32Array(nPools)
  if (!rate || !poolIds || !typeIds || !typeCount || !typeSum || !vizIndex || !rasterIndex || !spiked) {
    return {
      poolRates: pools,
      topK: [],
      vizRates: new Float32Array(0),
      raster: new Uint8Array(0),
      rasterRates: new Float32Array(0),
      meanRate: 0,
      rateStd: 0,
    }
  }
  typeSum.fill(0)
  let mean = 0
  let m2 = 0
  for (let i = 0; i < n; i++) {
    const r = rate[i]
    mean += r
    m2 += r * r
    const p = poolIds[i]
    pools[p] += r
    poolN[p]++
    typeSum[typeIds[i]] += r
  }
  for (let p = 0; p < nPools; p++) pools[p] = poolN[p] ? pools[p] / poolN[p] : 0
  mean /= n
  const variance = Math.max(0, m2 / n - mean * mean)
  const rateStd = Math.sqrt(variance)

  const top: { id: number; name: string; rate: number }[] = []
  for (let t = 0; t < typeCount.length; t++) {
    if (!typeCount[t]) continue
    const r = typeSum[t] / typeCount[t]
    const score = Math.abs(r - mean)
    if (top.length < 8) {
      top.push({ id: t, name: typeNames[t] ?? `t${t}`, rate: r })
      top.sort((a, b) => Math.abs(a.rate - mean) - Math.abs(b.rate - mean))
    } else if (score > Math.abs(top[0].rate - mean)) {
      top[0] = { id: t, name: typeNames[t] ?? `t${t}`, rate: r }
      top.sort((a, b) => Math.abs(a.rate - mean) - Math.abs(b.rate - mean))
    }
  }
  top.sort((a, b) => Math.abs(b.rate - mean) - Math.abs(a.rate - mean))

  const vizRates = new Float32Array(vizIndex.length)
  for (let i = 0; i < vizIndex.length; i++) vizRates[i] = rate[vizIndex[i]]
  const raster = new Uint8Array(rasterIndex.length)
  const rasterRates = new Float32Array(rasterIndex.length)
  for (let i = 0; i < rasterIndex.length; i++) {
    raster[i] = spiked[rasterIndex[i]]
    rasterRates[i] = rate[rasterIndex[i]]
  }

  return { poolRates: pools, topK: top, vizRates, raster, rasterRates, meanRate: mean, rateStd }
}

function sumInject(audio: Float32Array, video?: Float32Array): Float32Array {
  if (!video || video.length === 0) return audio
  const n = Math.min(audio.length, video.length)
  for (let i = 0; i < n; i++) audio[i] += video[i]
  return audio
}

self.onmessage = async (ev: MessageEvent<Incoming>) => {
  const msg = ev.data
  if (msg.type === 'ping') {
    self.postMessage({ type: 'pong' })
    return
  }
  if (msg.type === 'init') {
    try {
      const res = await fetch(msg.csrUrl)
      if (!res.ok) throw new Error(`CSR fetch ${res.status}`)
      const gz = await res.arrayBuffer()
      self.postMessage({ type: 'progress', phase: 'inflate', bytes: gz.byteLength })
      const raw = await gunzip(gz)
      parseCsr(raw)
      poolIds = msg.poolIds
      typeIds = msg.typeIds
      nPools = msg.nPools
      vizIndex = msg.vizIndex
      rasterIndex = msg.rasterIndex
      typeNames = msg.typeNames
      let tmax = 1
      for (let i = 0; i < typeIds.length; i++) if (typeIds[i] >= tmax) tmax = typeIds[i] + 1
      typeCount = new Uint32Array(tmax)
      typeSum = new Float32Array(tmax)
      for (let i = 0; i < typeIds.length; i++) typeCount[typeIds[i]]++
      ready = true
      const bootInj = new Float32Array(nPools).fill(0.45)
      const bootG = new Float32Array(nPools).fill(1)
      let bootSpikes = 0
      for (let s = 0; s < 6; s++) bootSpikes += stepOnce(bootInj, bootG, 0.016)
      self.postMessage({ type: 'ready', nNodes: n, nEdges: nnz, bootSpikes })
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  if (msg.type === 'step') {
    if (!ready) return
    const t0 = performance.now()
    let nSpikes = 0
    const dt = Number(msg.dt) > 0 ? msg.dt : 0.016
    const steps = Math.max(1, msg.steps | 0)
    const inject = sumInject(msg.inject, msg.videoInject)
    for (let s = 0; s < steps; s++) nSpikes += stepOnce(inject, msg.gains, dt)
    const ro = readout()
    self.postMessage(
      {
        type: 'state',
        ...ro,
        nSpikes,
        stepMs: performance.now() - t0,
      },
      [ro.poolRates.buffer, ro.vizRates.buffer, ro.raster.buffer, ro.rasterRates.buffer],
    )
  }
}

export {}
