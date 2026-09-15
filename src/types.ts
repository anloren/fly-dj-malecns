export type ControllerMode = 'random' | 'heuristic' | 'rl' | 'showcase'

export type TrainKnobs = {
  lr: number
  noiseScale: number
  wEnergy: number
  wClip: number
  wSilence: number
  wBeat: number
  wTeacher: number
  batchSize: number
  actionGain: number
}

export type Manifest = {
  dataset: string
  release: string
  nNodes: number
  nEdges: number
  nTypes: number
  pools: string[]
  csr: { file: string; uncompressedBytes: number; gzipBytes: number }
  nodes: string
  types: string
  pathways: Pathway[]
  typeCentroids: TypeCentroid[]
  honesty: string
  prune: { rule: string; minWeight: number; typedOnly: boolean }
  source: { weights: string; annotations: string; shells: string[]; featherMd5: string }
}

export type Pathway = {
  pre: number
  post: number
  preName: string
  postName: string
  weight: number
}

export type TypeCentroid = {
  id: number
  name: string
  n: number
  pool: string
  xyz: [number, number, number]
}

export type NodeData = {
  n: number
  pos: Float32Array
  typeIds: Uint16Array
  poolIds: Uint8Array
  hasSoma: Uint8Array
  sideIds: Uint8Array
  bodyIds: BigUint64Array
}

export type TypeBook = {
  types: string[]
  pools: string[]
}

export type AudioFeatures = {
  rms: number
  bass: number
  mid: number
  high: number
  centroid: number
  flux: number
  onset: number
  beat: number
  beatPhase: number
}

/** Cheap CPU video features — heuristic, not fly vision. */
export type VideoFeatures = {
  lum: number
  contrast: number
  red: number
  green: number
  blue: number
  motion: number
  flow: number
  edges: number
  hueWarm: number
  hueCool: number
  flash: number
  shake: number
}

export type DjAction = {
  crossfade: number
  filterA: number
  filterB: number
  lowEq: number
  master: number
  punch: number
}

export type FaderDeltas = Record<keyof DjAction, number>

export type Callout = {
  zh: string
  en: string
}

export type Readout = {
  poolRates: Float32Array
  topK: { id: number; name: string; rate: number }[]
  vizRates: Float32Array
  raster: Uint8Array
  rasterRates: Float32Array
  meanRate: number
  rateStd: number
  nSpikes: number
  stepMs: number
}

export const ACTION_KEYS: (keyof DjAction)[] = [
  'crossfade',
  'filterA',
  'filterB',
  'lowEq',
  'master',
  'punch',
]

export const POOL_ZH: Record<string, string> = {
  visual: '视觉',
  olfactory: '嗅觉',
  grn: '味觉 GRN',
  mechano: '机械感',
  hygro: '湿度',
  thermo: '温度',
  chemo: '化学感',
  sensory_other: '其他感觉',
  kenyon: 'Kenyon',
  cx: '中央复合体',
  alpn: 'ALPN',
  alln: 'ALLN',
  dan: 'DAN',
  mbon: 'MBON',
  alin: 'ALIN',
  alon: 'ALON',
  sezpn: 'SEZPN',
  motor: '运动',
  ascending: '上行',
  vnc: '腹神经索',
  central: '中枢',
  other: '其他',
}
