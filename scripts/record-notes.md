# 录屏注意事项 / Recording notes

Chrome must **never** show the Google Translate bar. The page is already `lang="zh-CN"` with `translate="no"`, `class="notranslate"`, and `<meta name="google" content="notranslate" />`. Still launch Chromium/Chrome so Translate UI cannot appear.

## Launch flags

```bash
google-chrome \
  --disable-features=Translate,TranslateUI \
  --lang=zh-CN \
  --accept-lang=zh-CN \
  --disable-translate \
  "http://127.0.0.1:47301/"
```

Equivalent Puppeteer / Playwright extras:

```js
const browser = await puppeteer.launch({
  executablePath: 'google-chrome',
  args: [
    '--disable-features=Translate,TranslateUI',
    '--lang=zh-CN',
    '--accept-lang=zh-CN',
    '--disable-translate',
  ],
})
```

If a translate infobar still appears: set Chrome language to match the page (`zh-CN`), dismiss it once, and prefer `chrome.tabs` / `page.evaluate` to keep `document.documentElement.lang === 'zh-CN'` and `translate="no"`. Do not rely on the address-bar translate icon staying hidden without the feature flags.

## Useful URLs

| URL | Use |
| --- | --- |
| `http://127.0.0.1:47301/` | Full app (CSR load, then Start the set) |
| `http://127.0.0.1:47301/?shot=booth` | Booth only — fly behind decks, 6 legs on controls, no CSR |

```bash
npm run dev          # :47301
node scripts/screenshot-booth.mjs   # writes handoff/fly-behind-decks.png
```

## Honesty (do not contradict on camera)

MaleCNS CSR synapses stay **frozen**. Only the sensory encoder, optional pathway gains, and DJ policy head train. Do not invent edges.
