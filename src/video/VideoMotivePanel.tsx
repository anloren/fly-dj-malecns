import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoFeatures } from '../types'
import { POOL_ZH } from '../types'
import { DEMO_SECONDS, drawDemoPattern } from './demoPattern'
import {
  EMPTY_VIDEO,
  VIDEO_DRIVE_POOLS,
  VIDEO_FEAT_META,
  VIDEO_H,
  VIDEO_HZ,
  VIDEO_W,
  drivenPoolCurrents,
  extractVideoFeatures,
  freshExtractState,
  videoToInject,
} from './features'

type SourceKind = 'none' | 'file' | 'camera' | 'demo'

type Props = {
  enabled: boolean
  onEnabled: (on: boolean) => void
  pools: string[]
  onSample: (feat: VideoFeatures | null, inject: Float32Array | null) => void
}

export function VideoMotivePanel({ enabled, onEnabled, pools, onSample }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const demoRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const workRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const objectUrl = useRef<string | null>(null)
  const camStream = useRef<MediaStream | null>(null)
  const extract = useRef(freshExtractState())
  const kindRef = useRef<SourceKind>('none')
  const demoStart = useRef(0)
  const enabledRef = useRef(enabled)
  const onSampleRef = useRef(onSample)
  const poolsRef = useRef(pools)

  const [kind, setKind] = useState<SourceKind>('none')
  const [feat, setFeat] = useState<VideoFeatures>(EMPTY_VIDEO)
  const [inject, setInject] = useState<Float32Array | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [demoT, setDemoT] = useState(0)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  useEffect(() => {
    onSampleRef.current = onSample
  }, [onSample])
  useEffect(() => {
    poolsRef.current = pools
  }, [pools])
  useEffect(() => {
    kindRef.current = kind
  }, [kind])

  const stopCamera = useCallback(() => {
    camStream.current?.getTracks().forEach((t) => t.stop())
    camStream.current = null
  }, [])

  const clearFileUrl = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopCamera()
      clearFileUrl()
    }
  }, [stopCamera, clearFileUrl])

  const emit = useCallback((next: VideoFeatures | null, inj: Float32Array | null) => {
    setFeat(next ?? EMPTY_VIDEO)
    setInject(inj)
    onSampleRef.current(enabledRef.current ? next : null, enabledRef.current ? inj : null)
  }, [])

  useEffect(() => {
    if (!enabled) onSampleRef.current(null, null)
  }, [enabled])

  useEffect(() => {
    const work = document.createElement('canvas')
    work.width = VIDEO_W
    work.height = VIDEO_H
    workRef.current = work
    const ctx = work.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 1000 / VIDEO_HZ) return
      last = now
      const k = kindRef.current
      const demo = demoRef.current
      const video = videoRef.current
      const preview = previewRef.current
      let src: CanvasImageSource | null = null
      if (k === 'demo' && demo) {
        const dctx = demo.getContext('2d')
        if (dctx) {
          if (!demoStart.current) demoStart.current = now
          const t = (now - demoStart.current) / 1000
          drawDemoPattern(dctx, t, demo.width, demo.height)
          setDemoT(t % DEMO_SECONDS)
          src = demo
        }
      } else if ((k === 'file' || k === 'camera') && video && video.readyState >= 2) {
        src = video
      }
      if (!src) {
        if (enabledRef.current) emit(EMPTY_VIDEO, new Float32Array(poolsRef.current.length))
        return
      }
      ctx.drawImage(src, 0, 0, VIDEO_W, VIDEO_H)
      const img = ctx.getImageData(0, 0, VIDEO_W, VIDEO_H)
      const next = extractVideoFeatures(img.data, VIDEO_W, VIDEO_H, extract.current)
      const inj = videoToInject(next, poolsRef.current)
      emit(next, inj)
      if (preview) {
        const pctx = preview.getContext('2d')
        if (pctx) {
          pctx.imageSmoothingEnabled = false
          pctx.drawImage(work, 0, 0, preview.width, preview.height)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [emit])

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    stopCamera()
    clearFileUrl()
    const url = URL.createObjectURL(file)
    objectUrl.current = url
    const video = videoRef.current
    if (!video) return
    video.srcObject = null
    video.src = url
    video.loop = true
    video.muted = true
    try {
      await video.play()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    extract.current = freshExtractState()
    setKind('file')
    onEnabled(true)
  }

  const startCamera = async () => {
    setErr(null)
    clearFileUrl()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      })
      stopCamera()
      camStream.current = stream
      const video = videoRef.current
      if (!video) return
      video.src = ''
      video.srcObject = stream
      video.muted = true
      await video.play()
      extract.current = freshExtractState()
      setKind('camera')
      onEnabled(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '摄像头不可用 / camera unavailable')
    }
  }

  const startDemo = () => {
    setErr(null)
    stopCamera()
    clearFileUrl()
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
    }
    demoStart.current = 0
    extract.current = freshExtractState()
    setKind('demo')
    onEnabled(true)
  }

  const currents = drivenPoolCurrents(enabled ? inject : null, pools)

  return (
    <section className={`video-motive ${enabled ? 'on' : ''}`}>
      <div className="video-motive-head">
        <label className="video-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
          <span>视频动机 / Video motive</span>
        </label>
        <div className="video-actions">
          <button type="button" onClick={() => fileRef.current?.click()}>
            选择视频 / File
          </button>
          <button type="button" onClick={() => void startCamera()}>
            摄像头 / Cam
          </button>
          <button type="button" className={kind === 'demo' ? 'on' : ''} onClick={startDemo}>
            20s 测试图案 / Test pattern
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => void loadFile(e.target.files?.[0])}
        />
      </div>
      <div className="video-motive-body">
        <div className="video-preview-wrap">
          <canvas ref={previewRef} className="video-preview" width={160} height={90} />
          <canvas ref={demoRef} className="video-demo" width={160} height={90} />
          <video ref={videoRef} className="video-el" muted playsInline loop />
          <p>
            {kind === 'demo'
              ? `测试图案 ${demoT.toFixed(1)}s / 20s`
              : kind === 'camera'
                ? '摄像头'
                : kind === 'file'
                  ? '本地视频'
                  : '无输入 / no source'}
          </p>
        </div>
        <div className="video-feats">
          {VIDEO_FEAT_META.map((m) => (
            <div key={m.key} className="video-feat">
              <span>
                {m.zh}
                <em>{m.en}</em>
              </span>
              <i>
                <b style={{ width: `${Math.min(100, feat[m.key] * 100)}%` }} />
              </i>
            </div>
          ))}
        </div>
        <div className="video-pools">
          <p>当前注入池 / pools with current</p>
          {currents.map((p) => (
            <span key={p.id} className={p.v > 0.08 ? 'hot' : ''}>
              {POOL_ZH[p.id] ?? p.id}
              <em>{p.id}</em>
              <b>{p.v.toFixed(2)}</b>
            </span>
          ))}
          <p className="video-hint">
            启发式映射：亮/色/边缘 → {POOL_ZH.visual}；帧差/抖动 → {POOL_ZH.mechano}；闪切残差 →{' '}
            {POOL_ZH.sensory_other}。不是果蝇视觉。
          </p>
        </div>
      </div>
      {err && <p className="video-err">{err}</p>}
      {!VIDEO_DRIVE_POOLS.every((id) => pools.includes(id)) && (
        <p className="video-err">typed pools missing visual / mechano / sensory_other</p>
      )}
    </section>
  )
}
