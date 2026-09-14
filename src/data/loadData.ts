import type { Manifest, NodeData, TypeBook } from '../types'

export function isGzip(buf: ArrayBuffer): boolean {
  const u = new Uint8Array(buf)
  return u.length >= 2 && u[0] === 0x1f && u[1] === 0x8b
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  // Vite/sirv may already inflate *.gz via Content-Encoding.
  if (!isGzip(buf)) return buf
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress gzip (DecompressionStream missing).')
  }
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

export async function fetchProgress(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  if (!res.body || !onProgress) return await res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, total)
  }
  const out = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out.buffer
}

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch('/data/manifest.json')
  if (!res.ok) throw new Error('manifest.json missing')
  return (await res.json()) as Manifest
}

export async function loadTypes(): Promise<TypeBook> {
  const buf = await fetchProgress('/data/types.json.gz')
  const raw = await gunzip(buf)
  return JSON.parse(new TextDecoder().decode(raw)) as TypeBook
}

export async function loadNodes(): Promise<NodeData> {
  const buf = await gunzip(await fetchProgress('/data/nodes.bin.gz'))
  const view = new DataView(buf)
  const n = view.getUint32(0, true)
  let off = 4
  const pos = new Float32Array(buf, off, n * 3)
  off += n * 3 * 4
  const typeIds = new Uint16Array(buf, off, n)
  off += n * 2
  const poolIds = new Uint8Array(buf, off, n)
  off += n
  const hasSoma = new Uint8Array(buf, off, n)
  off += n
  const sideIds = new Uint8Array(buf, off, n)
  off += n
  const bodyIds = new BigUint64Array(n)
  const dv = new DataView(buf)
  for (let i = 0; i < n; i++) bodyIds[i] = dv.getBigUint64(off + i * 8, true)
  return {
    n,
    pos: new Float32Array(pos),
    typeIds: new Uint16Array(typeIds),
    poolIds: new Uint8Array(poolIds),
    hasSoma: new Uint8Array(hasSoma),
    sideIds: new Uint8Array(sideIds),
    bodyIds,
  }
}

/** MaleCNS voxel (8 nm) → nanometres, matching official shell meshes. */
export function somaToNm(pos: Float32Array): Float32Array {
  const out = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] * 8
  return out
}
