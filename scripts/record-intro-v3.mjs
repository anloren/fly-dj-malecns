#!/usr/bin/env node
/**
 * Fly DJ intro v3 — headed Chrome + ffmpeg x11grab, RECORD_PLAN click clock.
 * Chrome Translate UI is disabled. Page already ships lang=zh-CN translate=no.
 *
 * Usage (dev server already on :47301):
 *   node scripts/record-intro-v3.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import puppeteer from 'puppeteer-core'

const URL = process.env.FLYDJ_URL || 'http://127.0.0.1:47301/'
const OUT_DIR = process.env.FLYDJ_OUT || '/tmp/fly-dj-v3'
const RAW = `${OUT_DIR}/raw-capture.mp4`
const DISPLAY = process.env.DISPLAY || ':1'
const DEBUG_PORT = Number(process.env.CDP_PORT || 9222)
const W = 1280
const H = 720
const DURATION = 136
const CHROME =
  process.env.CHROME_PATH ||
  '/usr/bin/google-chrome-stable'

mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sh(cmd) {
  return execFileSync('bash', ['-lc', cmd], { encoding: 'utf8' }).trim()
}

function waitPort(port, ms) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: '127.0.0.1', port }, () => {
        sock.end()
        resolve()
      })
      sock.on('error', () => {
        sock.destroy()
        if (Date.now() - t0 > ms) reject(new Error(`port ${port} timeout`))
        else setTimeout(tryOnce, 200)
      })
    }
    tryOnce()
  })
}

async function untilT(t0, sec) {
  const wait = t0 + sec * 1000 - Date.now()
  if (wait > 0) await sleep(wait)
}

function clickBox(page, re) {
  return page.evaluate((pattern) => {
    const rx = new RegExp(pattern)
    const el = [...document.querySelectorAll('button, label, input')].find((b) =>
      rx.test(b.textContent || ''),
    )
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim() }
  }, re)
}

async function mouseClick(page, box, steps = 10) {
  if (!box) return false
  await page.mouse.move(box.x, box.y, { steps })
  await sleep(80)
  await page.mouse.click(box.x, box.y)
  return true
}

async function clickText(page, re) {
  const box = await clickBox(page, re)
  if (!box) {
    console.warn('missing click target', re)
    return false
  }
  console.log('click', box.text)
  return mouseClick(page, box)
}

async function clickBed(page, label) {
  const box = await page.evaluate((lab) => {
    const el = [...document.querySelectorAll('.bed-pills button')].find(
      (b) => (b.textContent || '').trim() === lab,
    )
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.disabled }
  }, label)
  if (!box) {
    console.warn('missing bed', label)
    return false
  }
  if (box.disabled) {
    console.warn('bed locked', label)
    return false
  }
  console.log('bed', label)
  return mouseClick(page, box)
}

async function injectChrome(page) {
  await page.evaluate(() => {
    if (document.getElementById('rec-style')) return
    const style = document.createElement('style')
    style.id = 'rec-style'
    style.textContent = `
      html, body { overflow-x: hidden !important; }
      #rec-title, #rec-outro {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        text-align: center; pointer-events: none;
        font-family: 'Syne', 'Noto Sans SC', 'WenQuanYi Micro Hei', sans-serif;
        color: #f4f7ff;
      }
      #rec-title {
        background: linear-gradient(180deg, rgba(4,6,12,0.72), rgba(4,6,12,0.88));
      }
      #rec-title .credit {
        font-family: 'IBM Plex Mono', monospace;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: #ffc14a; font-size: 13px; margin-bottom: 18px;
      }
      #rec-title h1 {
        margin: 0; font-size: 72px; letter-spacing: 0.04em; line-height: 1;
        background: linear-gradient(90deg, #3ee0ff, #ff4da6);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      #rec-title h2 {
        margin: 14px 0 0; font-size: 28px; font-weight: 600; color: #d8e6ff;
        letter-spacing: 0.12em;
      }
      #rec-outro {
        background: rgba(3,5,10,0.82);
      }
      #rec-outro .card {
        border: 1px solid rgba(62,224,255,0.35);
        background: rgba(8,10,20,0.92);
        border-radius: 18px; padding: 28px 36px; min-width: 720px;
        box-shadow: 0 0 40px rgba(62,224,255,0.12);
      }
      #rec-outro .kicker {
        font-family: 'IBM Plex Mono', monospace; color: #ffc14a;
        letter-spacing: 0.16em; font-size: 12px; margin-bottom: 10px;
      }
      #rec-outro h1 { margin: 0 0 18px; font-size: 36px; }
      #rec-outro pre {
        margin: 0; padding: 14px 16px; text-align: left;
        background: #07080f; border-radius: 10px;
        font-family: 'IBM Plex Mono', monospace; font-size: 18px; color: #3ee0ff;
      }
      #rec-outro .url {
        margin: 14px 0 0; font-family: 'IBM Plex Mono', monospace;
        font-size: 16px; color: #d8e6ff;
      }
      #rec-outro .repo { color: #ff4da6; }
      #rec-outro .end {
        margin-top: 16px; color: #9aa6c8; font-size: 14px;
      }
      body.rec-hide-cursor, body.rec-hide-cursor * { cursor: none !important; }
    `
    document.head.appendChild(style)
    const title = document.createElement('div')
    title.id = 'rec-title'
    title.innerHTML = `
      <div class="credit">MaleCNS v1.0</div>
      <h1>果蝇中枢 DJ</h1>
      <h2>FLY DJ</h2>
    `
    title.style.display = 'none'
    document.body.appendChild(title)
    const outro = document.createElement('div')
    outro.id = 'rec-outro'
    outro.innerHTML = `
      <div class="card">
        <div class="kicker">CLONE · RUN LOCALLY</div>
        <h1>果蝇中枢 DJ / Fly DJ</h1>
        <pre>npm install && npm run dev</pre>
        <p class="url">http://127.0.0.1:47301</p>
        <p class="url repo">github.com/anloren/fly-dj-malecns</p>
        <p class="end">MaleCNS v1.0 · 诚实边界不变 · honesty bar stands</p>
      </div>
    `
    outro.style.display = 'none'
    document.body.appendChild(outro)
  })
}

async function setOverlay(page, which) {
  await page.evaluate((name) => {
    const title = document.getElementById('rec-title')
    const outro = document.getElementById('rec-outro')
    if (title) title.style.display = name === 'title' ? 'flex' : 'none'
    if (outro) outro.style.display = name === 'outro' ? 'flex' : 'none'
  }, which)
}

async function setCursor(page, show) {
  await page.evaluate((on) => {
    document.body.classList.toggle('rec-hide-cursor', !on)
  }, show)
}

async function cam(page, mode) {
  await page.evaluate((m) => {
    document.documentElement.style.scrollBehavior = 'auto'
    document.documentElement.style.zoom = ''
    document.documentElement.style.transform = ''
    const app = document.querySelector('.app')
    if (app) {
      app.style.transform = ''
      app.style.transformOrigin = 'top left'
    }
    const go = (sel, block = 'center') => {
      document.querySelector(sel)?.scrollIntoView({ behavior: 'instant', block, inline: 'nearest' })
    }
    if (m === 'full') {
      document.documentElement.scrollTop = 0
      document.scrollingElement && (document.scrollingElement.scrollTop = 0)
    } else if (m === 'honesty') {
      document.documentElement.style.zoom = '0.70'
      document.documentElement.scrollTop = 0
    } else if (m === 'left') {
      document.documentElement.scrollTop = 0
      go('.panel.connectome', 'start')
      if (app) app.style.transform = 'scale(1.06) translateX(2%)'
    } else if (m === 'right') {
      document.documentElement.scrollTop = 0
      go('.panel.booth', 'start')
      if (app) {
        app.style.transformOrigin = 'top right'
        app.style.transform = 'scale(1.07) translateX(-3%)'
      }
    } else if (m === 'console') {
      go('.train-console', 'start')
    } else if (m === 'beds') {
      go('.beds', 'center')
    } else if (m === 'video') {
      go('section.video-motive', 'center')
    } else if (m === 'chart') {
      go('.chart', 'center')
    } else if (m === 'booth-show') {
      go('.panel.booth', 'center')
      if (app) {
        app.style.transformOrigin = 'center right'
        app.style.transform = 'scale(1.06) translateX(-2%)'
      }
    }
  }, mode)
}

async function nudgeKnob(page, key, value) {
  const box = await page.evaluate((k, v) => {
    const label = [...document.querySelectorAll('.knob')].find((el) => {
      const input = el.querySelector('input[type=range]')
      return input && el.textContent && (k === 'lr' ? /学习率|LR/.test(el.textContent) : /动作增益|gain/.test(el.textContent))
    })
    const input = label?.querySelector('input[type=range]')
    if (!input) return null
    input.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = input.getBoundingClientRect()
    const min = Number(input.min)
    const max = Number(input.max)
    const t = (v - min) / (max - min)
    return { x: r.x + r.width * t, y: r.y + r.height / 2 }
  }, key, value)
  if (!box) return
  await page.mouse.move(box.x, box.y, { steps: 8 })
  await page.mouse.down()
  await page.mouse.move(box.x + 18, box.y, { steps: 6 })
  await page.mouse.up()
}

function restoreDisplay(prev) {
  if (!prev) return
  try {
    sh(`xrandr --output VNC-0 --mode ${prev}`)
  } catch (e) {
    console.warn('restore display failed', e.message)
  }
}

async function main() {
  let prevMode = '1920x1200'
  try {
    prevMode = sh(`xrandr | awk '/VNC-0 connected/{print $3}' | cut -d+ -f1`) || '1920x1200'
  } catch {
    /* keep default */
  }
  console.log('display was', prevMode)
  let resized = false
  try {
    sh('xrandr --output VNC-0 --mode 1280x720')
    resized = true
    console.log('display now 1280x720')
  } catch (e) {
    console.warn('xrandr 1280x720 failed, keeping', prevMode, e.message)
  }

  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=/tmp/flydj-chrome-v3`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-infobars',
    '--disable-session-crashed-bubble',
    '--disable-translate',
    '--disable-features=Translate,TranslateUI,TranslateKit,AutomationControlled',
    '--lang=zh-CN',
    '--accept-lang=zh-CN',
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
    '--disable-notifications',
    '--noerrdialogs',
    '--disable-component-update',
    '--disable-background-networking',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    `--window-size=${W},${H}`,
    '--window-position=0,0',
    '--kiosk',
    '--start-fullscreen',
    URL,
  ]

  console.log('launching chrome')
  const chrome = spawn(CHROME, chromeArgs, {
    stdio: 'ignore',
    env: {
      ...process.env,
      DISPLAY,
      LANGUAGE: 'zh-CN',
      LANG: 'zh-CN.UTF-8',
      LC_ALL: 'zh-CN.UTF-8',
    },
  })
  chrome.on('exit', (code) => console.log('chrome exit', code))
  await waitPort(DEBUG_PORT, 20000)

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  })
  const pages = await browser.pages()
  const page = pages.find((p) => p.url().includes('47301')) || pages[0] || (await browser.newPage())
  if (!page.url().includes('47301')) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 })
  }

  console.log('waiting LIF ready…')
  await page.waitForFunction(
    () => document.querySelector('button.go') && !document.querySelector('.boot'),
    { timeout: 180000 },
  )
  await page.evaluate(() => {
    try {
      localStorage.removeItem('flydj-train-knobs-v1')
    } catch {
      /* ignore */
    }
  })
  const preflight = await page.evaluate(() => {
    const body = document.body.innerText
    return {
      lang: document.documentElement.lang,
      translate: document.documentElement.getAttribute('translate'),
      bodyNo: document.body.classList.contains('notranslate'),
      boot: !!document.querySelector('.boot'),
      nodes: /164,?506/.test(body),
      edges: /10\.35M/.test(body),
      translateBar: !!document.querySelector('#goog-gt-tt, .goog-te-banner-frame, iframe.skiptranslate'),
    }
  })
  console.log('preflight', JSON.stringify(preflight))
  writeFileSync(`${OUT_DIR}/preflight.json`, JSON.stringify(preflight, null, 2))
  if (preflight.boot || !preflight.nodes || !preflight.edges) {
    throw new Error('LIF not ready or counts missing')
  }
  if (preflight.translateBar) throw new Error('Translate UI present')

  await injectChrome(page)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })

  try {
    const wid = sh(`xdotool search --onlyvisible --class chrome | tail -1 || xdotool search --onlyvisible --name 'Fly DJ' | tail -1`)
    if (wid) {
      sh(`xdotool windowmove ${wid} 0 0 windowsize ${wid} ${W} ${H}`)
      console.log('chrome window', wid)
    }
  } catch (e) {
    console.warn('xdotool', e.message)
  }

  console.log('starting ffmpeg x11grab')
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'x11grab',
      '-draw_mouse',
      '1',
      '-video_size',
      `${W}x${H}`,
      '-framerate',
      '30',
      '-i',
      `${DISPLAY}+0,0`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-an',
      RAW,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let ffErr = ''
  ff.stderr.on('data', (d) => {
    ffErr += d.toString()
  })
  await sleep(800)

  const t0 = Date.now()
  console.log('REC T=0')

  // Shot 1 0–5 title
  await setCursor(page, false)
  await cam(page, 'full')
  await setOverlay(page, 'title')
  await untilT(t0, 5.0)

  // Shot 2 5–14 honesty
  await setOverlay(page, 'none')
  await cam(page, 'honesty')
  await page.hover('footer.honesty').catch(() => {})
  await untilT(t0, 13.5)

  // Start + heuristic just before shot 3
  await cam(page, 'full')
  await setCursor(page, true)
  await clickText(page, '开始演出|Start the set')
  await sleep(200)
  await clickText(page, '启发式\\s*Heuristic')
  await untilT(t0, 14.0)

  // Shot 3 14–30 connectome left
  await cam(page, 'left')
  await setCursor(page, false)
  await untilT(t0, 30.0)

  // Shot 4 30–46 booth + fly
  await cam(page, 'right')
  await untilT(t0, 46.0)

  // Shot 5 46–56 start + knobs
  await cam(page, 'console')
  await setCursor(page, true)
  await clickText(page, '开始演出|Start the set').catch(() => {})
  await untilT(t0, 48.0)
  await clickText(page, '强化学习\\s*RL')
  await untilT(t0, 50.0)
  await page.evaluate(() => document.querySelector('.knobs')?.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await nudgeKnob(page, 'lr', 0.03)
  await sleep(400)
  await nudgeKnob(page, 'actionGain', 1.6)
  await untilT(t0, 56.0)

  // Shot 6 56–74 beds
  await cam(page, 'beds')
  await clickBed(page, 'Glitch 110')
  await page
    .waitForFunction(() => !/换轨中/.test(document.querySelector('.beds-head em')?.textContent || ''), {
      timeout: 6000,
    })
    .catch(() => {})
  await untilT(t0, 64.0)
  await clickBed(page, 'Breakbeat 140')
  await untilT(t0, 74.0)

  // Shot 7 74–98 video motive
  await cam(page, 'video')
  await page.evaluate(() => {
    const input = document.querySelector('.video-motive input[type=checkbox]')
    if (input && !input.checked) {
      input.click()
    }
    document.querySelector('section.video-motive')?.scrollIntoView({ block: 'center', behavior: 'instant' })
  })
  await untilT(t0, 75.0)
  await clickText(page, '20s 测试图案|Test pattern')
  await setCursor(page, false)
  await untilT(t0, 98.0)

  // Shot 8 98–110 Quick Train
  await cam(page, 'chart')
  await setCursor(page, true)
  const quick = await clickText(page, '快速训练|Quick Train')
  if (!quick) await clickText(page, '训练\\s*Train')
  await setCursor(page, false)
  await untilT(t0, 110.0)

  // Shot 9 110–126 Showcase
  await cam(page, 'booth-show')
  await setCursor(page, true)
  await clickText(page, '展示打碟|Showcase|演示')
  await setCursor(page, false)
  await untilT(t0, 126.0)

  // Shot 10 126–136 outro
  await cam(page, 'full')
  await setOverlay(page, 'outro')
  await untilT(t0, DURATION)

  console.log('REC_STOP elapsed', ((Date.now() - t0) / 1000).toFixed(2))
  ff.stdin?.end?.()
  ff.kill('SIGINT')
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 8000)
    ff.on('close', () => {
      clearTimeout(t)
      resolve()
    })
  })
  writeFileSync(`${OUT_DIR}/ffmpeg-grab.log`, ffErr.slice(-8000))
  console.log('wrote', RAW)

  await browser.disconnect()
  chrome.kill('SIGTERM')
  if (resized) restoreDisplay(prevMode)
}

main().catch((err) => {
  console.error(err)
  try {
    sh('xrandr --output VNC-0 --mode 1920x1200')
  } catch {
    /* ignore */
  }
  process.exit(1)
})
