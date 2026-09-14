import type { VideoFeatures } from '../types'

export const VIDEO_W = 80
export const VIDEO_H = 45
export const VIDEO_HZ = 15

export const EMPTY_VIDEO: VideoFeatures = {
  lum: 0,
  contrast: 0,
  red: 0,
  green: 0,
  blue: 0,
  motion: 0,
  flow: 0,
  edges: 0,
  hueWarm: 0,
  hueCool: 0,
  flash: 0,
  shake: 0,
}

export const VIDEO_FEAT_META: { key: keyof VideoFeatures; zh: string; en: string }[] = [
  { key: 'lum', zh: '亮度', en: 'luma' },
  { key: 'contrast', zh: '对比', en: 'contrast' },
  { key: 'red', zh: '红', en: 'red' },
  { key: 'green', zh: '绿', en: 'green' },
  { key: 'blue', zh: '蓝', en: 'blue' },
  { key: 'motion', zh: '帧差', en: 'diff' },
  { key: 'flow', zh: '光流代理', en: 'flow' },
  { key: 'edges', zh: '边缘', en: 'edges' },
  { key: 'hueWarm', zh: '暖色', en: 'warm' },
  { key: 'hueCool', zh: '冷色', en: 'cool' },
  { key: 'flash', zh: '闪切', en: 'flash' },
  { key: 'shake', zh: '抖动', en: 'shake' },
]

export const VIDEO_DRIVE_POOLS = ['visual', 'mechano', 'sensory_other'] as const

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export type VideoExtractState = {
  prevLum: Float32Array | null
  prevMean: number
  prevComX: number
  prevComY: number
  flash: number
  shake: number
}

export function freshExtractState(): VideoExtractState {
  return { prevLum: null, prevMean: 0, prevComX: 0.5, prevComY: 0.5, flash: 0, shake: 0 }
}

/**
 * 12-D visual/motion features from a downscaled RGBA frame.
 * Frame-diff + block shift is an optical-flow magnitude proxy, not real flow.
 */
export function extractVideoFeatures(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  state: VideoExtractState,
): VideoFeatures {
  const n = w * h
  const lum = new Float32Array(n)
  let sumL = 0
  let sumL2 = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let edge = 0
  let motion = 0
  let comX = 0
  let comY = 0
  let comW = 0
  let hueWarm = 0
  let hueCool = 0
  let hueMass = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const o = i * 4
      const r = rgba[o] / 255
      const g = rgba[o + 1] / 255
      const b = rgba[o + 2] / 255
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      lum[i] = l
      sumL += l
      sumL2 += l * l
      sumR += r
      sumG += g
      sumB += b
      if (x > 0) edge += Math.abs(l - lum[i - 1])
      if (y > 0) edge += Math.abs(l - lum[i - w])
      const maxc = Math.max(r, g, b)
      const minc = Math.min(r, g, b)
      const sat = maxc - minc
      if (sat > 0.08) {
        hueMass += sat
        if (r + 0.35 * g >= b) hueWarm += sat
        else hueCool += sat
      }
      if (state.prevLum) {
        const d = Math.abs(l - state.prevLum[i])
        motion += d
        comX += x * d
        comY += y * d
        comW += d
      }
    }
  }

  const meanL = n ? sumL / n : 0
  const varL = n ? Math.max(0, sumL2 / n - meanL * meanL) : 0
  const contrast = clamp01(Math.sqrt(varL) * 3.2)
  const motionN = clamp01(n ? (motion / n) * 4.2 : 0)
  const edgesN = clamp01(n ? (edge / n) * 3.4 : 0)
  const nx = comW > 1e-6 ? comX / comW / Math.max(1, w - 1) : 0.5
  const ny = comW > 1e-6 ? comY / comW / Math.max(1, h - 1) : 0.5
  const comVel = Math.hypot(nx - state.prevComX, ny - state.prevComY)
  const flow = blockFlowProxy(lum, state.prevLum, w, h)
  const dLum = meanL - state.prevMean
  const cut = Math.abs(dLum) > 0.18 ? clamp01((Math.abs(dLum) - 0.1) * 3.2) : 0
  const rise = dLum > 0.1 ? clamp01((dLum - 0.06) * 4.2) : 0
  const flash = clamp01(Math.max(rise, cut * 0.85, state.flash * 0.52))
  const shakeNow = clamp01(motionN * 0.55 + comVel * 2.4 + flow * 0.45)
  const shake = clamp01(Math.max(shakeNow, state.shake * 0.58))

  state.prevLum = lum
  state.prevMean = meanL
  state.prevComX = nx
  state.prevComY = ny
  state.flash = flash
  state.shake = shake

  return {
    lum: clamp01(meanL),
    contrast,
    red: clamp01(n ? sumR / n : 0),
    green: clamp01(n ? sumG / n : 0),
    blue: clamp01(n ? sumB / n : 0),
    motion: motionN,
    flow,
    edges: edgesN,
    hueWarm: hueMass > 1e-6 ? clamp01(hueWarm / hueMass) : 0,
    hueCool: hueMass > 1e-6 ? clamp01(hueCool / hueMass) : 0,
    flash,
    shake,
  }
}

/** 8×5 block mean-shift search — optical-flow magnitude proxy. */
function blockFlowProxy(cur: Float32Array, prev: Float32Array | null, w: number, h: number): number {
  if (!prev) return 0
  const gw = 8
  const gh = 5
  const bw = Math.max(1, Math.floor(w / gw))
  const bh = Math.max(1, Math.floor(h / gh))
  const meansC = new Float32Array(gw * gh)
  const meansP = new Float32Array(gw * gh)
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let sc = 0
      let sp = 0
      let c = 0
      const x0 = bx * bw
      const y0 = by * bh
      const x1 = Math.min(w, x0 + bw)
      const y1 = Math.min(h, y0 + bh)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x
          sc += cur[i]
          sp += prev[i]
          c++
        }
      }
      const k = by * gw + bx
      meansC[k] = c ? sc / c : 0
      meansP[k] = c ? sp / c : 0
    }
  }
  let mag = 0
  let used = 0
  for (let by = 1; by < gh - 1; by++) {
    for (let bx = 1; bx < gw - 1; bx++) {
      const target = meansC[by * gw + bx]
      let best = 1e9
      let bestD = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const err = Math.abs(target - meansP[(by + dy) * gw + (bx + dx)])
          if (err < best) {
            best = err
            bestD = Math.hypot(dx, dy)
          }
        }
      }
      mag += bestD
      used++
    }
  }
  return clamp01(used ? (mag / used) * 0.85 : 0)
}

export function videoToInject(feat: VideoFeatures, pools: readonly string[]): Float32Array {
  const inj = new Float32Array(pools.length)
  const ix = (name: string) => pools.indexOf(name)
  const visual = ix('visual')
  const mechano = ix('mechano')
  const other = ix('sensory_other')
  const rgb = (feat.red + feat.green + feat.blue) / 3
  if (visual >= 0) {
    inj[visual] =
      feat.lum * 0.72 +
      feat.contrast * 0.32 +
      feat.edges * 0.38 +
      rgb * 0.18 +
      feat.flash * 1.05 +
      Math.abs(feat.red - feat.blue) * 0.12
  }
  if (mechano >= 0) {
    inj[mechano] = feat.motion * 0.85 + feat.flow * 0.55 + feat.shake * 1.05
  }
  if (other >= 0) {
    inj[other] = feat.flash * 0.4 + feat.motion * 0.22 + feat.hueWarm * 0.18 + feat.hueCool * 0.1
  }
  return inj
}

export function sumInject(audio: Float32Array, video: Float32Array | null | undefined): Float32Array {
  const out = new Float32Array(audio)
  if (!video) return out
  const n = Math.min(out.length, video.length)
  for (let i = 0; i < n; i++) out[i] += video[i]
  return out
}

export function drivenPoolCurrents(
  inject: Float32Array | null,
  pools: readonly string[],
): { id: string; v: number }[] {
  if (!inject) return VIDEO_DRIVE_POOLS.map((id) => ({ id, v: 0 }))
  return VIDEO_DRIVE_POOLS.map((id) => {
    const i = pools.indexOf(id)
    return { id, v: i >= 0 ? (inject[i] ?? 0) : 0 }
  })
}
