import type { AudioFeatures, DjAction } from '../types'
import { ACTION_KEYS } from '../types'
import { clamp } from '../audio/djEngine'

function randn(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export class Dense {
  w: Float32Array
  b: Float32Array
  inDim: number
  outDim: number
  lastX: Float32Array = new Float32Array(0)
  lastY: Float32Array = new Float32Array(0)

  constructor(inDim: number, outDim: number, scale: number, rng: () => number) {
    this.inDim = inDim
    this.outDim = outDim
    this.w = new Float32Array(inDim * outDim)
    this.b = new Float32Array(outDim)
    for (let i = 0; i < this.w.length; i++) this.w[i] = (rng() * 2 - 1) * scale
  }

  forward(x: Float32Array): Float32Array {
    this.lastX = new Float32Array(x)
    const y = new Float32Array(this.outDim)
    for (let o = 0; o < this.outDim; o++) {
      let s = this.b[o]
      for (let i = 0; i < this.inDim; i++) s += this.w[i * this.outDim + o] * x[i]
      y[o] = s
    }
    this.lastY = y
    return y
  }

  backward(dy: Float32Array, lr: number, weight: number): Float32Array {
    const dx = new Float32Array(this.inDim)
    const x = this.lastX
    for (let o = 0; o < this.outDim; o++) {
      const g = dy[o] * weight
      this.b[o] += lr * g
      for (let i = 0; i < this.inDim; i++) {
        const idx = i * this.outDim + o
        dx[i] += this.w[idx] * g
        this.w[idx] += lr * g * x[i]
      }
    }
    return dx
  }
}

export function tanhArr(x: Float32Array): Float32Array {
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i])
  return y
}

export function tanhBackward(y: Float32Array, dy: Float32Array): Float32Array {
  const dx = new Float32Array(y.length)
  for (let i = 0; i < y.length; i++) dx[i] = dy[i] * (1 - y[i] * y[i])
  return dx
}

export function featVec(f: AudioFeatures): Float32Array {
  return Float32Array.of(f.rms, f.bass, f.mid, f.high, f.centroid, f.flux, f.onset, f.beat)
}

export class Encoder {
  h1: Dense
  h2: Dense
  logStd: Float32Array
  hidden: Float32Array = new Float32Array(0)

  constructor(nPools: number, rng: () => number) {
    this.h1 = new Dense(8, 24, 0.35, rng)
    this.h2 = new Dense(24, nPools, 0.15, rng)
    this.logStd = new Float32Array(nPools)
    this.logStd.fill(-1.6)
  }

  mean(feat: AudioFeatures): Float32Array {
    this.hidden = new Float32Array(tanhArr(this.h1.forward(featVec(feat))))
    const raw = this.h2.forward(this.hidden)
    const y = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) y[i] = softplus(raw[i]) * 0.55
    return y
  }

  sample(feat: AudioFeatures, rng: () => number, noiseScale = 1): { inject: Float32Array; logp: number } {
    const mu = this.mean(feat)
    const inject = new Float32Array(mu.length)
    let logp = 0
    const n = Math.max(0.15, noiseScale)
    for (let i = 0; i < mu.length; i++) {
      const sig = Math.exp(this.logStd[i]) * n
      const z = randn(rng)
      inject[i] = Math.max(0, mu[i] + sig * z)
      logp += -0.5 * z * z - Math.log(sig + 1e-8) - 0.5 * Math.log(2 * Math.PI)
    }
    return { inject, logp }
  }

  reinforce(feat: AudioFeatures, inject: Float32Array, adv: number, lr: number): void {
    const mu = this.mean(feat)
    const dRaw = new Float32Array(mu.length)
    for (let i = 0; i < mu.length; i++) {
      const sig = Math.exp(this.logStd[i])
      const z = (inject[i] - mu[i]) / (sig + 1e-6)
      dRaw[i] = ((inject[i] - mu[i]) / (sig * sig + 1e-6)) * dSoftplus(this.h2.lastY[i]) * 0.55
      this.logStd[i] = clamp(this.logStd[i] + lr * 0.15 * adv * (z * z - 1), -3.2, -0.4)
    }
    const dH = this.h2.backward(dRaw, lr, adv)
    this.h1.backward(tanhBackward(this.hidden, dH), lr, 1)
  }
}

export class PolicyHead {
  h1: Dense
  h2: Dense
  logStd: Float32Array
  hidden: Float32Array = new Float32Array(0)
  inDim: number

  constructor(inDim: number, rng: () => number) {
    this.inDim = inDim
    this.h1 = new Dense(inDim, 36, 0.28, rng)
    this.h2 = new Dense(36, ACTION_KEYS.length, 0.12, rng)
    this.logStd = new Float32Array(ACTION_KEYS.length)
    this.logStd.fill(-1.1)
  }

  mean(state: Float32Array): Float32Array {
    this.hidden = new Float32Array(tanhArr(this.h1.forward(state)))
    const raw = this.h2.forward(this.hidden)
    const y = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) y[i] = 1 / (1 + Math.exp(-raw[i]))
    return y
  }

  sample(state: Float32Array, rng: () => number, noiseScale = 1): { action: DjAction; logp: number; vec: Float32Array } {
    const mu = this.mean(state)
    const vec = new Float32Array(mu.length)
    let logp = 0
    const n = Math.max(0.12, noiseScale)
    for (let i = 0; i < mu.length; i++) {
      const sig = Math.exp(this.logStd[i]) * n
      const z = randn(rng)
      vec[i] = clamp(mu[i] + sig * z, 0, 1)
      logp += -0.5 * z * z - Math.log(sig + 1e-8) - 0.5 * Math.log(2 * Math.PI)
    }
    return { action: vecToAction(vec), logp, vec }
  }

  act(state: Float32Array): { action: DjAction; vec: Float32Array } {
    const vec = this.mean(state)
    return { action: vecToAction(vec), vec }
  }

  imitate(state: Float32Array, target: Float32Array, lr: number): number {
    const mu = this.mean(state)
    const dRaw = new Float32Array(mu.length)
    let loss = 0
    for (let i = 0; i < mu.length; i++) {
      const err = target[i] - mu[i]
      loss += err * err
      const s = mu[i]
      dRaw[i] = err * s * (1 - s)
    }
    const dH = this.h2.backward(dRaw, lr, 1)
    this.h1.backward(tanhBackward(this.hidden, dH), lr, 1)
    return loss / mu.length
  }

  reinforce(state: Float32Array, vec: Float32Array, adv: number, lr: number): void {
    const mu = this.mean(state)
    const dRaw = new Float32Array(mu.length)
    for (let i = 0; i < mu.length; i++) {
      const sig = Math.exp(this.logStd[i])
      const z = (vec[i] - mu[i]) / (sig + 1e-6)
      const s = mu[i]
      dRaw[i] = ((vec[i] - mu[i]) / (sig * sig + 1e-6)) * s * (1 - s)
      this.logStd[i] = clamp(this.logStd[i] + lr * 0.2 * adv * (z * z - 1), -2.8, -0.25)
    }
    const dH = this.h2.backward(dRaw, lr, adv)
    this.h1.backward(tanhBackward(this.hidden, dH), lr, 1)
  }
}

export class Gains {
  values: Float32Array
  logStd: Float32Array
  constructor(n: number) {
    this.values = new Float32Array(n)
    this.values.fill(1)
    this.logStd = new Float32Array(n)
    this.logStd.fill(-2.0)
  }
  sample(rng: () => number): { gains: Float32Array; logp: number } {
    const g = new Float32Array(this.values.length)
    let logp = 0
    for (let i = 0; i < g.length; i++) {
      const sig = Math.exp(this.logStd[i])
      const z = randn(rng)
      g[i] = clamp(this.values[i] + sig * z, 0.15, 2.8)
      logp += -0.5 * z * z - this.logStd[i] - 0.5 * Math.log(2 * Math.PI)
    }
    return { gains: g, logp }
  }
  reinforce(sampled: Float32Array, adv: number, lr: number): void {
    for (let i = 0; i < this.values.length; i++) {
      const sig = Math.exp(this.logStd[i])
      const z = (sampled[i] - this.values[i]) / (sig + 1e-6)
      this.values[i] = clamp(this.values[i] + lr * adv * z, 0.2, 2.5)
      this.logStd[i] = clamp(this.logStd[i] + lr * 0.1 * adv * (z * z - 1), -3.0, -0.8)
    }
  }
}

export function vecToAction(v: Float32Array): DjAction {
  return {
    crossfade: v[0] ?? 0.5,
    filterA: v[1] ?? 0.5,
    filterB: v[2] ?? 0.5,
    lowEq: v[3] ?? 0.5,
    master: v[4] ?? 0.5,
    punch: v[5] ?? 0.2,
  }
}

export function buildState(poolRates: Float32Array, extra: number[]): Float32Array {
  const s = new Float32Array(poolRates.length + extra.length)
  s.set(poolRates)
  for (let i = 0; i < extra.length; i++) s[poolRates.length + i] = extra[i]
  return s
}

function softplus(x: number): number {
  if (x > 20) return x
  return Math.log1p(Math.exp(x))
}

function dSoftplus(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
