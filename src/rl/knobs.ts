import type { DjAction, TrainKnobs } from '../types'
import { ACTION_KEYS } from '../types'

export const KNOB_STORAGE = 'flydj-train-knobs-v1'

export const DEFAULT_KNOBS: TrainKnobs = {
  lr: 0.018,
  noiseScale: 0.85,
  wEnergy: 1.1,
  wClip: 1,
  wSilence: 1.2,
  wBeat: 1.15,
  wTeacher: 0.55,
  batchSize: 2,
  actionGain: 1.25,
}

export const QUICK_KNOBS: TrainKnobs = {
  lr: 0.048,
  noiseScale: 0.62,
  wEnergy: 0.85,
  wClip: 0.7,
  wSilence: 1.4,
  wBeat: 1.7,
  wTeacher: 1.55,
  batchSize: 1,
  actionGain: 1.95,
}

export const SHOWCASE_GAIN = 2.15

export function loadKnobs(): TrainKnobs {
  try {
    const raw = localStorage.getItem(KNOB_STORAGE)
    if (!raw) return { ...DEFAULT_KNOBS }
    return { ...DEFAULT_KNOBS, ...(JSON.parse(raw) as Partial<TrainKnobs>) }
  } catch {
    return { ...DEFAULT_KNOBS }
  }
}

export function saveKnobs(k: TrainKnobs): void {
  try {
    localStorage.setItem(KNOB_STORAGE, JSON.stringify(k))
  } catch {
    /* ignore quota */
  }
}

export function emptyDeltas(): Record<keyof DjAction, number> {
  return { crossfade: 0, filterA: 0, filterB: 0, lowEq: 0, master: 0, punch: 0 }
}

export function actionVec(a: DjAction): Float32Array {
  return Float32Array.of(a.crossfade, a.filterA, a.filterB, a.lowEq, a.master, a.punch)
}

export const ACTION_LABELS: Record<keyof DjAction, { zh: string; en: string }> = {
  crossfade: { zh: '交叉推子', en: 'XF' },
  filterA: { zh: '滤波 A', en: 'FLT A' },
  filterB: { zh: '滤波 B', en: 'FLT B' },
  lowEq: { zh: '低频', en: 'LOW' },
  master: { zh: '主音量', en: 'MST' },
  punch: { zh: '冲击', en: 'PUNCH' },
}

export { ACTION_KEYS }
