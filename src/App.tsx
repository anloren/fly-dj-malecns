import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DjEngine,
  calloutFromDelta,
  ensureAudible,
  exaggerate,
  heuristicAction,
  randomAction,
  rewardOf,
  teacherAction,
} from './audio/djEngine'
import { loadManifest, loadNodes, loadTypes } from './data/loadData'
import { ACTION_LABELS, DEFAULT_KNOBS, QUICK_KNOBS, SHOWCASE_GAIN, emptyDeltas, loadKnobs, saveKnobs } from './rl/knobs'
import { Encoder, Gains, PolicyHead, buildState, mulberry32 } from './rl/network'
import type {
  AudioFeatures,
  Callout,
  ControllerMode,
  DjAction,
  FaderDeltas,
  Manifest,
  NodeData,
  Readout,
  TrainKnobs,
  TypeBook,
} from './types'
import { ACTION_KEYS, POOL_ZH } from './types'
import { BoothView } from './viz/BoothView'
import { ConnectomeView } from './viz/ConnectomeView'
import './App.css'

const DEFAULT_ACTION: DjAction = {
  crossfade: 0.5,
  filterA: 0.55,
  filterB: 0.55,
  lowEq: 0.45,
  master: 0.52,
  punch: 0.15,
}

const SHOT_FEATURES: AudioFeatures = {
  rms: 0.4,
  bass: 0.35,
  mid: 0.4,
  high: 0.3,
  centroid: 0.4,
  flux: 0.12,
  onset: 0,
  beat: 0.35,
  beatPhase: 0,
}

function isBoothShot(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('shot') === 'booth'
}

function BoothShot() {
  const [action, setAction] = useState<DjAction>({
    crossfade: 0.28,
    filterA: 0.72,
    filterB: 0.38,
    lowEq: 0.62,
    master: 0.7,
    punch: 0.48,
  })
  const [features, setFeatures] = useState<AudioFeatures>(SHOT_FEATURES)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      setAction({
        crossfade: 0.5 + Math.sin(t * 0.65) * 0.32,
        filterA: 0.5 + Math.sin(t * 0.9 + 0.4) * 0.3,
        filterB: 0.5 + Math.cos(t * 0.8) * 0.3,
        lowEq: 0.5 + Math.sin(t * 0.55 + 1.1) * 0.28,
        master: 0.55 + Math.sin(t * 0.45) * 0.22,
        punch: 0.35 + Math.max(0, Math.sin(t * 1.6)) * 0.5,
      })
      setFeatures({
        ...SHOT_FEATURES,
        beat: 0.25 + Math.max(0, Math.sin(t * 6.2)) * 0.6,
        beatPhase: (t * 1.4) % 1,
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="app notranslate shot-booth" translate="no">
      <BoothView action={action} features={features} waveform={null} playing showcase={false} />
    </div>
  )
}

const SHOWCASE_UNLOCK = 0.12
const QUICK_MS = 52000

type LoadPhase = 'boot' | 'data' | 'csr' | 'ready' | 'error'
type ShowcasePhase = 'heuristic' | 'trained' | null

export default function App() {
  if (isBoothShot()) return <BoothShot />
  return <FlyDjApp />
}

function FlyDjApp() {
  const [phase, setPhase] = useState<LoadPhase>('boot')
  const [progress, setProgress] = useState('正在读取清单…')
  const [error, setError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [nodes, setNodes] = useState<NodeData | null>(null)
  const [types, setTypes] = useState<TypeBook | null>(null)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<ControllerMode>('heuristic')
  const [training, setTraining] = useState(false)
  const [action, setAction] = useState<DjAction>(DEFAULT_ACTION)
  const [features, setFeatures] = useState<AudioFeatures | null>(null)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [rewards, setRewards] = useState<number[]>([])
  const [advantages, setAdvantages] = useState<number[]>([])
  const [episode, setEpisode] = useState(0)
  const [lastReward, setLastReward] = useState(0)
  const [lastAdv, setLastAdv] = useState(0)
  const [lastLoss, setLastLoss] = useState(0)
  const [workerMs, setWorkerMs] = useState(0)
  const [wave, setWave] = useState<Uint8Array | null>(null)
  const [knobs, setKnobs] = useState<TrainKnobs>(() => (typeof localStorage === 'undefined' ? DEFAULT_KNOBS : loadKnobs()))
  const [quickLeft, setQuickLeft] = useState(0)
  const [trainedReady, setTrainedReady] = useState(false)
  const [showcasePhase, setShowcasePhase] = useState<ShowcasePhase>(null)
  const showcasePhaseRef = useRef<ShowcasePhase>(null)
  const [callout, setCallout] = useState<Callout | null>(null)
  const [deltas, setDeltas] = useState<FaderDeltas>(emptyDeltas)
  const [injects, setInjects] = useState<Float32Array | null>(null)

  const djRef = useRef<DjEngine | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const modeRef = useRef<ControllerMode>('heuristic')
  const trainRef = useRef(false)
  const actionRef = useRef(DEFAULT_ACTION)
  const knobsRef = useRef(knobs)
  const encoderRef = useRef<Encoder | null>(null)
  const policyRef = useRef<PolicyHead | null>(null)
  const gainsRef = useRef<Gains | null>(null)
  const baselineRef = useRef(0)
  const rngRef = useRef(mulberry32(20260608))
  const pendingRef = useRef<{
    inject: Float32Array
    gains: Float32Array
    logp: number
    actionVec: Float32Array
    feat: AudioFeatures
    state: Float32Array
    teacher: Float32Array
  } | null>(null)
  type TrainStep = NonNullable<typeof pendingRef.current> & { reward: number }
  const batchRef = useRef<TrainStep[]>([])
  const waveBuf = useRef(new Uint8Array(1024))
  const vizIndex = useRef<Uint32Array>(new Uint32Array(0))
  const clockRef = useRef(0)
  const actionHist = useRef<{ t: number; a: DjAction }[]>([])
  const quickUntil = useRef(0)
  const showcaseUntil = useRef(0)
  const showcaseStart = useRef(0)
  const calloutUntil = useRef(0)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    trainRef.current = training
  }, [training])
  useEffect(() => {
    knobsRef.current = knobs
    saveKnobs(knobs)
  }, [knobs])

  const rewardMa = useMemo(() => {
    if (!rewards.length) return 0
    const s = rewards.slice(-16)
    return s.reduce((a, b) => a + b, 0) / s.length
  }, [rewards])

  useEffect(() => {
    if (rewardMa >= SHOWCASE_UNLOCK && episode > 40) setTrainedReady(true)
  }, [rewardMa, episode])

  const pickViz = useCallback((n: NodeData) => {
    const want = 14000
    const idx: number[] = []
    for (let i = 0; i < n.n && idx.length < want; i += Math.max(1, Math.floor(n.n / want))) {
      if (n.hasSoma[i] || idx.length < want * 0.85) idx.push(i)
    }
    vizIndex.current = Uint32Array.from(idx)
    return vizIndex.current
  }, [])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        setPhase('data')
        setProgress('读取 MaleCNS 清单与胞体…')
        const [man, nd, tb] = await Promise.all([loadManifest(), loadNodes(), loadTypes()])
        if (dead) return
        setManifest(man)
        setNodes(nd)
        setTypes(tb)
        const viz = pickViz(nd)
        const raster: number[] = []
        for (let p = 0; p < tb.pools.length && raster.length < 72; p++) {
          for (let i = 0; i < nd.n && raster.length < 72; i++) {
            if (nd.poolIds[i] === p && nd.hasSoma[i]) {
              raster.push(i)
              break
            }
          }
        }
        while (raster.length < 72) raster.push(raster.length % nd.n)

        const rng = rngRef.current
        encoderRef.current = new Encoder(tb.pools.length, rng)
        policyRef.current = new PolicyHead(tb.pools.length + 8, rng)
        gainsRef.current = new Gains(tb.pools.length)

        setPhase('csr')
        setProgress('解压冻结 CSR（~31 MB gzip → 10.3M 边）…')
        const worker = new Worker(new URL('./sim/lif.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
        worker.onmessage = (ev: MessageEvent) => {
          const msg = ev.data
          if (msg.type === 'progress') setProgress(`CSR 已下载 ${(msg.bytes / 1e6).toFixed(1)} MB，正在解压…`)
          if (msg.type === 'error') {
            setError(msg.message)
            setPhase('error')
          }
          if (msg.type === 'ready') {
            setProgress(`LIF 就绪 · ${msg.nNodes} 节点 / ${msg.nEdges} 边 · boot ${msg.bootSpikes ?? 0} spikes`)
            setPhase('ready')
            const nP = tb.pools.length
            worker.postMessage({
              type: 'step',
              inject: new Float32Array(nP),
              gains: new Float32Array(nP).fill(1),
              steps: 1,
              dt: 0.016,
            })
          }
          if (msg.type === 'state') {
            setWorkerMs(msg.stepMs)
            const ro: Readout = {
              poolRates: msg.poolRates,
              topK: msg.topK,
              vizRates: msg.vizRates,
              raster: msg.raster,
              rasterRates: msg.rasterRates ?? new Float32Array(0),
              meanRate: msg.meanRate,
              rateStd: msg.rateStd ?? 0,
              nSpikes: msg.nSpikes,
              stepMs: msg.stepMs,
            }
            setReadout(ro)
            const dj = djRef.current
            if (!dj?.started) {
              const nP = tb.pools.length
              worker.postMessage({
                type: 'step',
                inject: new Float32Array(nP),
                gains: new Float32Array(nP).fill(1),
                steps: 1,
                dt: 0.016,
              })
              return
            }
            const feat = dj.features()
            setFeatures(feat)
            dj.waveform(waveBuf.current)
            setWave(waveBuf.current.slice())
            clockRef.current += 0.032
            const t = clockRef.current
            const k = knobsRef.current
            const teach = teacherAction(feat, t)

            const extra = [feat.rms, feat.bass, feat.high, feat.onset, feat.beat, feat.centroid, ro.meanRate, ro.nSpikes / 4000]
            const state = buildState(ro.poolRates, extra)
            const enc = encoderRef.current
            const pol = policyRef.current
            const gn = gainsRef.current
            if (!enc || !pol || !gn) return

            let next = actionRef.current
            let logp = 0
            let inject: Float32Array = new Float32Array(enc.mean(feat))
            let gains: Float32Array = new Float32Array(gn.values)
            let avec: Float32Array = new Float32Array([
              next.crossfade,
              next.filterA,
              next.filterB,
              next.lowEq,
              next.master,
              next.punch,
            ])

            const m = modeRef.current
            const now = performance.now()
            let phaseNow: ShowcasePhase = null
            if (m === 'showcase') {
              const elapsed = now - (showcaseStart.current || now)
              phaseNow = elapsed < 8000 ? 'heuristic' : 'trained'
              if (phaseNow !== showcasePhaseRef.current) {
                showcasePhaseRef.current = phaseNow
                setShowcasePhase(phaseNow)
              }
            }
            if (m === 'showcase' && phaseNow === 'heuristic') next = heuristicAction(feat)
            else if (m === 'heuristic') next = heuristicAction(feat)
            else if (m === 'random') next = randomAction(actionRef.current, rngRef.current)
            else if (m === 'showcase') {
              const pa = pol.act(state)
              next = ensureAudible(pa.action, teach, Math.min(SHOWCASE_GAIN, 1.15 + k.actionGain * 0.25))
              inject = new Float32Array(enc.mean(feat))
              gains = new Float32Array(gn.values)
              avec = new Float32Array(pa.vec)
            } else {
              const sm = enc.sample(feat, rngRef.current, k.noiseScale)
              inject = new Float32Array(sm.inject)
              const gs = gn.sample(rngRef.current)
              gains = new Float32Array(gs.gains)
              const pa = pol.sample(state, rngRef.current, k.noiseScale)
              next = exaggerate(pa.action, k.actionGain)
              logp = sm.logp + gs.logp + pa.logp
              avec = new Float32Array([next.crossfade, next.filterA, next.filterB, next.lowEq, next.master, next.punch])
            }

            const tau = m === 'showcase' ? 0.016 : 0.04
            dj.apply(next, tau)
            const prevAct = actionRef.current
            actionRef.current = next
            setAction(next)
            setInjects(inject)

            const note = calloutFromDelta(prevAct, next)
            if (note && (m === 'showcase' || Math.abs(next.crossfade - prevAct.crossfade) > 0.05)) {
              setCallout(note)
              calloutUntil.current = now + 1400
            } else if (now > calloutUntil.current) {
              setCallout(null)
            }

            const hist = actionHist.current
            hist.push({ t: now, a: { ...next } })
            while (hist.length && now - hist[0].t > 1000) hist.shift()
            if (hist.length > 1) {
              const first = hist[0].a
              const d = emptyDeltas()
              for (const key of ACTION_KEYS) d[key] = next[key] - first[key]
              setDeltas(d)
            }

            const r = rewardOf(feat, next, dj.peak, k, teach)
            setLastReward(r)
            const doTrain = trainRef.current && m === 'rl'
            if (doTrain && pendingRef.current) {
              const prev = pendingRef.current
              batchRef.current.push({ ...prev, reward: r })
              if (batchRef.current.length >= Math.max(1, Math.round(k.batchSize))) {
                const batch = batchRef.current
                batchRef.current = []
                const meanR = batch.reduce((s, b) => s + b.reward, 0) / batch.length
                let lossAcc = 0
                let advAcc = 0
                for (const step of batch) {
                  const base = baselineRef.current
                  const adv = step.reward - base
                  baselineRef.current = base * 0.9 + step.reward * 0.1
                  enc.reinforce(step.feat, step.inject, adv, k.lr)
                  pol.reinforce(step.state, step.actionVec, adv, k.lr)
                  gn.reinforce(step.gains, adv, k.lr * 0.55)
                  if (k.wTeacher > 0.05) lossAcc += pol.imitate(step.state, step.teacher, k.lr * (0.35 + k.wTeacher * 0.4))
                  advAcc += adv
                }
                const adv = advAcc / batch.length
                setLastAdv(adv)
                setLastLoss(lossAcc / batch.length)
                setAdvantages((h) => {
                  const nextH = h.length > 180 ? h.slice(-180) : h.slice()
                  nextH.push(adv)
                  return nextH
                })
                void meanR
              }
              setRewards((histR) => {
                const nextH = histR.length > 240 ? histR.slice(-240) : histR.slice()
                nextH.push(r)
                return nextH
              })
              setEpisode((e) => e + 1)
            } else if (trainRef.current || m === 'showcase') {
              setRewards((histR) => {
                const nextH = histR.length > 240 ? histR.slice(-240) : histR.slice()
                nextH.push(r)
                return nextH
              })
              if (trainRef.current) setEpisode((e) => e + 1)
            }

            pendingRef.current = {
              inject,
              gains,
              logp,
              actionVec: avec,
              feat,
              state,
              teacher: Float32Array.of(teach.crossfade, teach.filterA, teach.filterB, teach.lowEq, teach.master, teach.punch),
            }
            const liveInject = new Float32Array(inject)
            for (let i = 0; i < liveInject.length; i++) liveInject[i] += 0.2
            worker.postMessage({ type: 'step', inject: liveInject, gains, steps: 2, dt: 0.016 })
          }
        }
        worker.postMessage({
          type: 'init',
          csrUrl: '/data/weights.csr.bin.gz',
          poolIds: nd.poolIds,
          typeIds: nd.typeIds,
          nPools: tb.pools.length,
          vizIndex: viz,
          rasterIndex: Uint32Array.from(raster),
          typeNames: tb.types,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    })()
    return () => {
      dead = true
      workerRef.current?.terminate()
    }
  }, [pickViz])

  useEffect(() => {
    if (!quickLeft) return
    const id = window.setInterval(() => {
      const left = Math.max(0, quickUntil.current - performance.now())
      setQuickLeft(left)
      if (left <= 0) {
        window.clearInterval(id)
        setTraining(false)
        setTrainedReady(true)
        setMode('rl')
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [quickLeft])

  const startShow = useCallback(async () => {
    try {
      const ctx = new AudioContext()
      const dj = new DjEngine(ctx)
      await dj.loadBeds('/audio/deck-a.wav', '/audio/deck-b.wav')
      await dj.start()
      dj.apply(actionRef.current)
      djRef.current = dj
      setPlaying(true)
      workerRef.current?.postMessage({
        type: 'step',
        inject: new Float32Array(types?.pools.length ?? 22),
        gains: new Float32Array(types?.pools.length ?? 22).fill(1),
        steps: 1,
        dt: 0.016,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [types])

  const onMode = (m: ControllerMode) => {
    if (m === 'showcase') {
      enterShowcase()
      return
    }
    setMode(m)
    setShowcasePhase(null)
    if (m !== 'rl') setTraining(false)
  }

  const enterShowcase = () => {
    setTraining(false)
    setMode('showcase')
    setShowcasePhase('heuristic')
    showcaseStart.current = performance.now()
    showcaseUntil.current = performance.now() + 16000
    showcasePhaseRef.current = 'heuristic'
    setCallout({ zh: '对照启发式 8 秒 → 训练后 8 秒', en: 'Heuristic vs Trained' })
    calloutUntil.current = performance.now() + 2200
  }

  const startQuickTrain = () => {
    if (!playing) return
    setKnobs({ ...QUICK_KNOBS })
    setMode('rl')
    setTraining(true)
    setTrainedReady(true)
    setShowcasePhase(null)
    quickUntil.current = performance.now() + QUICK_MS
    setQuickLeft(QUICK_MS)
  }

  const patchKnob = (key: keyof TrainKnobs, value: number) => {
    setKnobs((k) => ({ ...k, [key]: value }))
  }

  const poolBars = useMemo(() => {
    if (!readout || !types) return []
    return types.pools.map((p, i) => ({
      id: p,
      zh: POOL_ZH[p] ?? p,
      v: readout.poolRates[i] ?? 0,
      inj: Number.isFinite(injects?.[i]) ? (injects?.[i] ?? 0) : 0,
    }))
  }, [readout, types, injects])

  const topInjects = useMemo(() => {
    return poolBars
      .slice()
      .sort((a, b) => b.inj - a.inj)
      .slice(0, 4)
  }, [poolBars])

  return (
    <div className="app notranslate" translate="no">
      <header className="topbar">
        <div className="brand">
          <span className="mark">♂</span>
          <div>
            <h1>果蝇中枢 DJ</h1>
            <p>Fly DJ · MaleCNS v1.0 anatomical CSR · in-browser RL</p>
          </div>
        </div>
        <div className="top-stats">
          <Stat k="节点 / nodes" v={manifest ? manifest.nNodes.toLocaleString() : '—'} />
          <Stat k="突触边 / edges" v={manifest ? `${(manifest.nEdges / 1e6).toFixed(2)}M` : '—'} />
          <Stat k="LIF ms" v={workerMs ? workerMs.toFixed(1) : '—'} />
          <Stat k="发放 / spikes" v={readout ? String(readout.nSpikes) : '—'} />
          <Stat k="奖励 MA / R" v={rewardMa.toFixed(3)} />
        </div>
      </header>

      {phase !== 'ready' && (
        <div className="boot">
          <div className="boot-card">
            <p className="kicker">loading official MaleCNS</p>
            <h2>{phase === 'error' ? '无法启动' : '正在装配中枢'}</h2>
            <p>{error ?? progress}</p>
            <div className="bar">
              <i style={{ width: phase === 'csr' ? '70%' : phase === 'error' ? '100%' : '35%' }} />
            </div>
          </div>
        </div>
      )}

      {phase === 'ready' && manifest && nodes && types && (
        <>
          <main className="split">
            <ConnectomeView
              nodes={nodes}
              types={types}
              manifest={manifest}
              vizIndex={vizIndex.current}
              vizRates={readout?.vizRates ?? null}
              raster={readout?.raster ?? null}
              rasterRates={readout?.rasterRates ?? null}
              topK={readout?.topK ?? []}
              meanRate={readout?.meanRate ?? 0}
              rateStd={readout?.rateStd ?? 0}
            />
            <BoothView
              action={action}
              features={features}
              waveform={wave}
              playing={playing}
              showcase={mode === 'showcase'}
              showcasePhase={showcasePhase}
              callout={callout}
            />
          </main>

          <section className="console train-console">
            <div className="console-left">
              <div className="modes">
                {(['random', 'heuristic', 'rl'] as ControllerMode[]).map((m) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)} type="button">
                    {m === 'random' ? '随机 Random' : m === 'heuristic' ? '启发式 Heuristic' : '强化学习 RL'}
                  </button>
                ))}
              </div>
              {!playing ? (
                <button className="go" type="button" onClick={startShow}>
                  开始演出 / Start the set
                </button>
              ) : (
                <div className="train-actions">
                  <button
                    className={`go train ${training ? 'hot' : ''}`}
                    type="button"
                    disabled={mode !== 'rl'}
                    onClick={() => setTraining((t) => !t)}
                  >
                    {training ? '停止训练 / Stop' : '训练 Train'}
                  </button>
                  <button className="go quick" type="button" disabled={!!quickLeft} onClick={startQuickTrain}>
                    {quickLeft ? `快速训练 ${Math.ceil(quickLeft / 1000)}s` : '快速训练 / Quick Train'}
                  </button>
                  <button className={`go showcase ${trainedReady ? 'ready' : ''}`} type="button" disabled={!playing} onClick={enterShowcase}>
                    展示打碟 / Showcase
                  </button>
                </div>
              )}
              {quickLeft > 0 && (
                <div className="quick-bar">
                  <i style={{ width: `${100 - (quickLeft / QUICK_MS) * 100}%` }} />
                </div>
              )}
              <p className="hint">
                {mode === 'showcase'
                  ? '学习已冻结。先听 8 秒启发式对照，再听训练后的夸张交叉/滤波/冲击。'
                  : mode === 'rl'
                    ? 'REINFORCE + 教师塑形。CSR 边权冻结。Quick Train 约 50 秒后可点 Showcase。'
                    : mode === 'heuristic'
                      ? '启发式把低频/频谱映射到推子，不更新权重。'
                      : '随机游走推子，用作对照——Showcase 必须在约 10 秒内听出差别。'}
              </p>
              <KnobPanel knobs={knobs} onChange={patchKnob} />
            </div>
            <div className="dash">
              <RewardChart values={rewards} advantages={advantages} episode={episode} last={lastReward} ma={rewardMa} />
              <div className="dash-stats">
                <Stat k="回合 / ep" v={String(episode)} />
                <Stat k="优势 / adv" v={lastAdv.toFixed(3)} />
                <Stat k="模仿损失" v={lastLoss.toFixed(3)} />
                <Stat k="即时 R" v={lastReward.toFixed(3)} />
              </div>
              <div className="delta-row">
                <p>推子 Δ / last 1s</p>
                <div className="deltas">
                  {ACTION_KEYS.map((key) => (
                    <span key={key} className={Math.abs(deltas[key]) > 0.08 ? 'hot' : ''}>
                      {ACTION_LABELS[key].zh}
                      <b>
                        {deltas[key] >= 0 ? '+' : ''}
                        {deltas[key].toFixed(2)}
                      </b>
                    </span>
                  ))}
                </div>
              </div>
              <p className="inject-label">高注入池 / high injects</p>
              <div className="injects">
                {topInjects.map((p) => (
                  <span key={p.id}>
                    {p.zh} <b>{p.inj.toFixed(2)}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="pools">
              {poolBars.map((p) => (
                <div key={p.id} className="pool">
                  <span>
                    {p.zh}
                    <em>{p.id}</em>
                  </span>
                  <i>
                    <b style={{ width: `${Math.min(100, p.v * 140)}%` }} />
                  </i>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <footer className="honesty">
        <p>
          <b>诚实说明 / Honesty.</b>{' '}
          {manifest?.honesty ??
            'CSR synapses are frozen MaleCNS v1.0 counts. Only the sensory encoder, optional pathway gains, and DJ policy head are trained. This is not biological spike data.'}{' '}
          边来自官方 feather（MD5 <code>f30e9dcca25cfd021bf1e7b3d975599e</code>），规则为 weight≥3 且
          typed↔typed，从未编造突触。壳体为 FlyEM 官方 CB / OL / VNC neuropil shell，已抽稀仅供浏览器显示。音频为程序合成的可循环床，经 Web
          Audio 双唱盘、交叉推子、滤波、低频 EQ 与主音量真实播放。
        </p>
      </footer>
    </div>
  )
}

function KnobPanel({ knobs, onChange }: { knobs: TrainKnobs; onChange: (k: keyof TrainKnobs, v: number) => void }) {
  const rows: { key: keyof TrainKnobs; zh: string; en: string; min: number; max: number; step: number }[] = [
    { key: 'lr', zh: '学习率', en: 'LR', min: 0.002, max: 0.08, step: 0.002 },
    { key: 'noiseScale', zh: '噪声', en: 'noise', min: 0.15, max: 1.8, step: 0.05 },
    { key: 'actionGain', zh: '动作增益', en: 'gain', min: 0.6, max: 2.8, step: 0.05 },
    { key: 'batchSize', zh: '批大小', en: 'batch', min: 1, max: 8, step: 1 },
    { key: 'wEnergy', zh: '能量', en: 'energy', min: 0, max: 2.4, step: 0.05 },
    { key: 'wClip', zh: '抗削波', en: 'clip', min: 0, max: 2.4, step: 0.05 },
    { key: 'wSilence', zh: '抗静音', en: 'silence', min: 0, max: 2.4, step: 0.05 },
    { key: 'wBeat', zh: '节拍', en: 'beat', min: 0, max: 2.6, step: 0.05 },
    { key: 'wTeacher', zh: '教师塑形', en: 'teacher', min: 0, max: 2.2, step: 0.05 },
  ]
  return (
    <div className="knobs">
      {rows.map((r) => (
        <label key={r.key} className="knob">
          <span>
            {r.zh} <em>{r.en}</em>
          </span>
          <input
            type="range"
            min={r.min}
            max={r.max}
            step={r.step}
            value={knobs[r.key]}
            onChange={(e) => onChange(r.key, Number(e.target.value))}
          />
          <b>{r.key === 'batchSize' ? knobs[r.key].toFixed(0) : knobs[r.key].toFixed(2)}</b>
        </label>
      ))}
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <em>{k}</em>
      <strong>{v}</strong>
    </div>
  )
}

function RewardChart({
  values,
  advantages,
  episode,
  last,
  ma,
}: {
  values: number[]
  advantages: number[]
  episode: number
  last: number
  ma: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cvs = ref.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const w = cvs.width
    const h = cvs.height
    ctx.fillStyle = '#07080f'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(62,224,255,0.15)'
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
    const draw = (arr: number[], color: string, width: number) => {
      if (arr.length < 2) return
      const min = Math.min(...arr, -0.2)
      const max = Math.max(...arr, 0.2)
      const span = max - min || 1
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      arr.forEach((v, i) => {
        const x = (i / Math.max(1, arr.length - 1)) * w
        const y = h - ((v - min) / span) * (h - 8) - 4
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    draw(values, '#3ee0ff', 1.6)
    if (values.length >= 2) {
      const maLine: number[] = []
      for (let i = 0; i < values.length; i++) {
        const s = values.slice(Math.max(0, i - 11), i + 1)
        maLine.push(s.reduce((a, b) => a + b, 0) / s.length)
      }
      draw(maLine, 'rgba(255,193,74,0.85)', 1.5)
    }
    draw(advantages, 'rgba(255,77,166,0.7)', 1.1)
  }, [values, advantages])

  return (
    <div className="chart">
      <p>
        奖励 / reward <em>ep {episode}</em> <b>{last.toFixed(3)}</b> <em>MA {ma.toFixed(3)}</em>
      </p>
      <canvas ref={ref} width={420} height={110} />
    </div>
  )
}
