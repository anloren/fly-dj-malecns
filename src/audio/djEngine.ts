import type { AudioFeatures, DjAction } from '../types'

const FFT = 2048

export class DjEngine {
  readonly ctx: AudioContext
  readonly masterGain: GainNode
  readonly analyser: AnalyserNode
  readonly deckA: Deck
  readonly deckB: Deck
  private xfA: GainNode
  private xfB: GainNode
  private lowEq: BiquadFilterNode
  private punch: GainNode
  private freqA = new Float32Array(FFT)
  private prevMag = new Float32Array(FFT / 2)
  private time = new Uint8Array(FFT)
  private beatPhase = 0
  started = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.deckA = new Deck(ctx)
    this.deckB = new Deck(ctx)
    this.xfA = ctx.createGain()
    this.xfB = ctx.createGain()
    this.lowEq = ctx.createBiquadFilter()
    this.lowEq.type = 'lowshelf'
    this.lowEq.frequency.value = 180
    this.punch = ctx.createGain()
    this.masterGain = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = FFT
    this.analyser.smoothingTimeConstant = 0.55

    this.deckA.out.connect(this.xfA)
    this.deckB.out.connect(this.xfB)
    this.xfA.connect(this.lowEq)
    this.xfB.connect(this.lowEq)
    this.lowEq.connect(this.punch)
    this.punch.connect(this.masterGain)
    this.masterGain.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    this.xfA.gain.value = 0.707
    this.xfB.gain.value = 0.707
    this.masterGain.gain.value = 0.55
    this.punch.gain.value = 1
  }

  async loadBeds(urlA: string, urlB: string): Promise<void> {
    const [a, b] = await Promise.all([fetch(urlA), fetch(urlB)])
    if (!a.ok || !b.ok) throw new Error('DJ beds missing — expected /audio/deck-a.wav and deck-b.wav')
    const [bufA, bufB] = await Promise.all([
      this.ctx.decodeAudioData(await a.arrayBuffer()),
      this.ctx.decodeAudioData(await b.arrayBuffer()),
    ])
    this.deckA.setBuffer(bufA)
    this.deckB.setBuffer(bufB)
  }

  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.deckA.start()
    this.deckB.start()
    this.started = true
  }

  apply(action: DjAction, tau = 0.04): void {
    const x = clamp(action.crossfade, 0, 1)
    const now = this.ctx.currentTime
    this.xfA.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), now, tau)
    this.xfB.gain.setTargetAtTime(Math.sin((x * Math.PI) / 2), now, tau)
    this.deckA.setFilter(action.filterA, tau)
    this.deckB.setFilter(action.filterB, tau)
    this.lowEq.gain.setTargetAtTime((clamp(action.lowEq, 0, 1) - 0.5) * 18, now, tau + 0.01)
    const master = clamp(action.master, 0.02, 1)
    this.masterGain.gain.setTargetAtTime(master, now, tau + 0.01)
    this.punch.gain.setTargetAtTime(1 + clamp(action.punch, 0, 1) * 0.55, now, Math.max(0.012, tau * 0.7))
  }

  features(): AudioFeatures {
    this.analyser.getByteTimeDomainData(this.time)
    this.analyser.getFloatFrequencyData(this.freqA)
    let sum = 0
    let peak = 0
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128
      sum += v * v
      peak = Math.max(peak, Math.abs(v))
    }
    const rms = Math.sqrt(sum / this.time.length)

    const ny = this.ctx.sampleRate / 2
    const binHz = ny / (FFT / 2)
    let bass = 0,
      mid = 0,
      high = 0,
      numB = 0,
      numM = 0,
      numH = 0
    let magSum = 0
    let freqW = 0
    let flux = 0
    const nBins = FFT / 2
    for (let i = 1; i < nBins; i++) {
      const db = this.freqA[i]
      const lin = Math.max(0, (db + 100) / 100)
      const hz = i * binHz
      if (hz < 180) {
        bass += lin
        numB++
      } else if (hz < 2500) {
        mid += lin
        numM++
      } else {
        high += lin
        numH++
      }
      magSum += lin
      freqW += lin * hz
      const d = lin - this.prevMag[i]
      if (d > 0) flux += d
      this.prevMag[i] = lin
    }
    bass = numB ? bass / numB : 0
    mid = numM ? mid / numM : 0
    high = numH ? high / numH : 0
    const centroid = magSum > 1e-6 ? clamp(freqW / magSum / 6000, 0, 1) : 0.3
    flux = clamp(flux / 40, 0, 1)
    const onset = flux > 0.18 ? clamp((flux - 0.18) * 3, 0, 1) : 0
    // 120 BPM beds — lock a running phase to wall time
    const bpm = 120
    this.beatPhase = ((this.ctx.currentTime * bpm) / 60) % 1
    const beat = this.beatPhase < 0.12 ? 1 - this.beatPhase / 0.12 : 0

    return {
      rms: clamp(rms * 2.2, 0, 1),
      bass: clamp(bass * 1.6, 0, 1),
      mid: clamp(mid * 1.3, 0, 1),
      high: clamp(high * 1.5, 0, 1),
      centroid,
      flux,
      onset,
      beat,
      beatPhase: this.beatPhase,
    }
  }

  waveform(target: Uint8Array<ArrayBuffer>): void {
    this.analyser.getByteTimeDomainData(target)
  }

  get peak(): number {
    this.analyser.getByteTimeDomainData(this.time)
    let p = 0
    for (let i = 0; i < this.time.length; i++) p = Math.max(p, Math.abs(this.time[i] - 128))
    return p / 128
  }
}

class Deck {
  readonly filter: BiquadFilterNode
  readonly out: GainNode
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private ctx: AudioContext
  running = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 12000
    this.filter.Q.value = 0.7
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.filter.connect(this.out)
  }

  setBuffer(buf: AudioBuffer): void {
    this.buffer = buf
  }

  start(): void {
    if (!this.buffer || this.running) return
    this.source = this.ctx.createBufferSource()
    this.source.buffer = this.buffer
    this.source.loop = true
    this.source.connect(this.filter)
    this.source.start()
    this.running = true
  }

  setFilter(amount: number, tau = 0.04): void {
    const a = clamp(amount, 0, 1)
    // 0 = dark lowpass, 0.5 = open, 1 = bright highpass-ish (still LP but high)
    const hz = 160 * Math.pow(110, a)
    this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, tau)
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export type RewardWeights = {
  wEnergy: number
  wClip: number
  wSilence: number
  wBeat: number
  wTeacher: number
}

export function teacherAction(feat: AudioFeatures, t: number): DjAction {
  const phrase = Math.sin(t * 0.52)
  const phrase2 = Math.cos(t * 0.37)
  const xf = clamp(0.5 + phrase * 0.42 + (feat.onset - 0.25) * 0.28 + feat.beatPhase * 0.08 - 0.04, 0.04, 0.96)
  return {
    crossfade: xf,
    filterA: clamp(0.22 + 0.62 * (0.5 + 0.5 * phrase2) + feat.bass * 0.18, 0.04, 0.98),
    filterB: clamp(0.22 + 0.62 * (0.5 + 0.5 * Math.sin(t * 0.71)) + feat.high * 0.2, 0.04, 0.98),
    lowEq: clamp(0.28 + feat.bass * 0.5 - feat.onset * 0.08, 0.05, 0.95),
    master: clamp(0.46 + feat.rms * 0.22 + feat.beat * 0.28 + feat.onset * 0.12, 0.28, 0.96),
    punch: clamp(feat.beat * 0.95 + feat.onset * 0.75, 0, 1),
  }
}

export function exaggerate(action: DjAction, gain: number): DjAction {
  const g = Math.max(0.2, gain)
  const push = (v: number, extra = 0) => clamp(0.5 + (v - 0.5) * g + extra, 0, 1)
  return {
    crossfade: push(action.crossfade),
    filterA: push(action.filterA),
    filterB: push(action.filterB),
    lowEq: push(action.lowEq, 0),
    master: clamp(0.5 + (action.master - 0.5) * Math.min(g, 1.8), 0.12, 0.98),
    punch: clamp(action.punch * (0.65 + g * 0.45), 0, 1),
  }
}

export function lerpAction(a: DjAction, b: DjAction, t: number): DjAction {
  const u = clamp(t, 0, 1)
  return {
    crossfade: a.crossfade + (b.crossfade - a.crossfade) * u,
    filterA: a.filterA + (b.filterA - a.filterA) * u,
    filterB: a.filterB + (b.filterB - a.filterB) * u,
    lowEq: a.lowEq + (b.lowEq - a.lowEq) * u,
    master: a.master + (b.master - a.master) * u,
    punch: a.punch + (b.punch - a.punch) * u,
  }
}

export function dramaScore(action: DjAction): number {
  return (
    Math.abs(action.crossfade - 0.5) * 1.4 +
    Math.abs(action.filterA - action.filterB) * 0.9 +
    action.punch * 0.55 +
    Math.abs(action.master - 0.5) * 0.35
  )
}

export function ensureAudible(policy: DjAction, teacher: DjAction, gain: number): DjAction {
  const g = clamp(gain, 1.05, 1.75)
  const ex = exaggerate(policy, g)
  const swept = lerpAction(ex, teacher, 0.42)
  return {
    crossfade: clamp(swept.crossfade, 0.08, 0.92),
    filterA: clamp(swept.filterA, 0.12, 0.9),
    filterB: clamp(swept.filterB, 0.12, 0.9),
    lowEq: clamp(swept.lowEq, 0.12, 0.88),
    master: clamp(swept.master, 0.28, 0.86),
    punch: clamp(swept.punch, 0.05, 0.95),
  }
}

export function rewardOf(feat: AudioFeatures, action: DjAction, peak: number, w?: RewardWeights, teacher?: DjAction): number {
  const weights = w ?? { wEnergy: 1, wClip: 1, wSilence: 1, wBeat: 1, wTeacher: 0 }
  const target = 0.28
  const energy = -Math.abs(feat.rms - target) * 2.2 * weights.wEnergy
  const clip = peak > 0.92 ? -(((peak - 0.92) * 8) ** 2) * weights.wClip : 0
  const silence = feat.rms < 0.045 ? -1.15 * weights.wSilence : 0
  const beatAlign = (feat.beat * (0.4 + feat.onset * 0.95) + feat.onset * 0.28) * weights.wBeat
  const antiMud = feat.bass > 0.85 && action.lowEq > 0.82 ? -0.22 : 0
  const presence = feat.mid * 0.18 + feat.high * 0.14
  const drama = (feat.onset + feat.beat) * (Math.abs(action.crossfade - 0.5) * 0.55 + Math.abs(action.filterA - action.filterB) * 0.3)
  let imitate = 0
  if (teacher && weights.wTeacher > 0) {
    imitate =
      -weights.wTeacher *
      (Math.abs(action.crossfade - teacher.crossfade) * 1.15 +
        Math.abs(action.filterA - teacher.filterA) * 0.7 +
        Math.abs(action.filterB - teacher.filterB) * 0.7 +
        Math.abs(action.punch - teacher.punch) * 0.85 +
        Math.abs(action.master - teacher.master) * 0.45)
  }
  return energy + clip + silence + beatAlign + antiMud + presence + drama + imitate
}

export const CALLOUTS: { key: keyof DjAction; test: (d: number, a: DjAction) => boolean; zh: string; en: string }[] = [
  { key: 'crossfade', test: (d, a) => Math.abs(d) > 0.07 && a.crossfade > 0.55, zh: '交叉推到 B 盘', en: 'crossfade A→B' },
  { key: 'crossfade', test: (d, a) => Math.abs(d) > 0.07 && a.crossfade < 0.45, zh: '交叉推到 A 盘', en: 'crossfade B→A' },
  { key: 'filterA', test: (d) => d > 0.08, zh: '打开 A 滤波', en: 'open filter A' },
  { key: 'filterA', test: (d) => d < -0.08, zh: '关掉 A 滤波', en: 'close filter A' },
  { key: 'filterB', test: (d) => d > 0.08, zh: '打开 B 滤波', en: 'open filter B' },
  { key: 'filterB', test: (d) => d < -0.08, zh: '关掉 B 滤波', en: 'close filter B' },
  { key: 'master', test: (d) => d > 0.06, zh: '主音量上推', en: 'volume pump' },
  { key: 'punch', test: (d, a) => d > 0.1 || a.punch > 0.72, zh: '节拍冲击', en: 'onset punch' },
  { key: 'lowEq', test: (d) => Math.abs(d) > 0.08, zh: '低频扫动', en: 'low EQ sweep' },
]

export function calloutFromDelta(prev: DjAction, next: DjAction): { zh: string; en: string } | null {
  let best: { zh: string; en: string; score: number } | null = null
  for (const c of CALLOUTS) {
    const d = next[c.key] - prev[c.key]
    if (!c.test(d, next)) continue
    const score = Math.abs(d) + (c.key === 'crossfade' ? 0.08 : 0)
    if (!best || score > best.score) best = { zh: c.zh, en: c.en, score }
  }
  return best
}

export function heuristicAction(feat: AudioFeatures): DjAction {
  return {
    crossfade: clamp(0.5 + (feat.centroid - 0.45) * 0.7, 0.08, 0.92),
    filterA: clamp(0.35 + feat.bass * 0.45, 0, 1),
    filterB: clamp(0.4 + feat.high * 0.5, 0, 1),
    lowEq: clamp(0.35 + feat.bass * 0.4, 0, 1),
    master: clamp(0.42 + feat.rms * 0.25, 0.2, 0.8),
    punch: clamp(feat.onset * 0.7 + feat.beat * 0.4, 0, 1),
  }
}

export function randomAction(prev: DjAction, rnd: () => number): DjAction {
  const walk = (v: number, s: number) => clamp(v + (rnd() - 0.5) * s, 0, 1)
  return {
    crossfade: walk(prev.crossfade, 0.08),
    filterA: walk(prev.filterA, 0.1),
    filterB: walk(prev.filterB, 0.1),
    lowEq: walk(prev.lowEq, 0.08),
    master: walk(prev.master, 0.06),
    punch: walk(prev.punch, 0.2),
  }
}
