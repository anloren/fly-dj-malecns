#!/usr/bin/env node
/**
 * Headless booth still. Chrome must be launched without Translate UI.
 * Usage: node scripts/screenshot-booth.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:47301/?shot=booth'
const out = resolve(process.argv[3] ?? 'handoff/fly-behind-decks.png')
mkdirSync(dirname(out), { recursive: true })

const chrome =
  process.env.CHROME_PATH ||
  ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(Boolean)

const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--disable-features=Translate,TranslateUI',
  '--lang=zh-CN',
  '--accept-lang=zh-CN',
  '--disable-translate',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,900',
  '--virtual-time-budget=6000',
  `--screenshot=${out}`,
  url,
]

const child = spawn(chrome, args, { stdio: 'inherit' })
child.on('exit', (code) => {
  if (code) {
    console.error(`chrome exited ${code}`)
    process.exit(code ?? 1)
  }
  console.log(`wrote ${out}`)
})
