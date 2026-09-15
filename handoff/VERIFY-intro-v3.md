# Fly DJ intro v3 — VERIFY

Recaptured 2026-09-15 against `main` @ `7759565` (bed pills + video motive + MaleCNS CSR).

This pass locks the recorder to the live UI strings:

- Showcase is **「展示打碟 / Showcase」** — never 「演示 / Showcase」
- Quick Train is **「快速训练 / Quick Train」** — bottom console is scrolled into view first
- Bed pills and **视频动机 / Video motive** + **20s 测试图案 / Test pattern** are on the clock

## Files

| File | Path |
| --- | --- |
| Picture (ASS burned, no audio) | `handoff/Fly-DJ-intro-v3.mp4` |
| Picture + looped beds | `handoff/Fly-DJ-intro-v3-AUDIO.mp4` |
| ASS (BorderStyle=1 outline) | `handoff/Fly-DJ-intro-v3.ass` |
| Artifacts copies | `/opt/cursor/artifacts/Fly-DJ-intro-v3.mp4` · `Fly-DJ-intro-v3-AUDIO.mp4` |

## Probe

| Check | Result |
| --- | --- |
| Resolution | **1280×720** (both) |
| Duration | picture **136.37 s** · AUDIO **136.00 s** (target 130–140) |
| Video codec | H.264 yuv420p 30 fps |
| AUDIO | H.264 + AAC 192k · Techno 0–57 → Glitch 57–64 → Breakbeat 64–136 |
| ASS | `ffmpeg -vf ass=` · font WenQuanYi Micro Hei · **BorderStyle=1** outline, no box |
| App build | app source unchanged on this branch |

## Chrome / Translate

Launch flags: `--disable-features=Translate,TranslateUI --lang=zh-CN --accept-lang=zh-CN --disable-translate` + kiosk 1280×720.

Page preflight (before REC):

```json
{"lang":"zh-CN","translate":"no","bodyNo":true,"boot":false,"nodes":true,"edges":true,"translateBar":false}
```

Exact-label preflight after Start the set:

```json
{"start":true,"quick":true,"showcase":true,"showcaseWrong":false,"trainToggle":true,"testPattern":true,"videoMotive":true,"beds":["Techno 120","Glitch 110","Ambient 90","Breakbeat 140"]}
```

No Google Translate infobar. Recorder throws if Showcase is 「演示 / Showcase」 or if Quick Train / beds / video motive labels are missing.

## LIF / counts

Waited until `.boot` gone. On-screen **164,506** nodes / **10.35M** edges (manifest 10,349,880). CSR gzip present.

## Click log (exact strings)

| Clock | Action | Logged |
| --- | --- | --- |
| preflight | `开始演出 / Start the set` · `启发式 Heuristic` | yes |
| 48 s | `强化学习 RL` | visible |
| 56–64 s | beds `Glitch 110` then `Breakbeat 140` | `bed-on` matched |
| 75 s | `20s 测试图案 / Test pattern` | `checked:true` · `demoOn:true` · `测试图案 0.5s / 20s` |
| 98 s | `快速训练 / Quick Train` | visible · `quick-train-running true` |
| 110 s | `展示打碟 / Showcase` | visible · never `演示` |

## Shot clock (sampled frames)

| t | Shot | Present |
| --- | --- | --- |
| 0–5 s | Title overlay 果蝇中枢 DJ / FLY DJ / MaleCNS v1.0 | yes (asserted before REC) |
| 5–14 s | Honesty zoom-out + top stats 164,506 / 10.35M | yes |
| 14–30 s | Left connectome lock (soma heat + raster) | yes |
| 30–46 s | Booth + 6-leg fly (XF / FLT A / LOW / FLT B / MST / PUNCH) | yes |
| 46–56 s | Console · RL · knobs | yes |
| 56–74 s | Bed pills Techno 120 → Glitch 110 → Breakbeat 140 | pills on camera; clicks logged |
| 74–98 s | Video motive · 20s test pattern · 「不是果蝇视觉」 | panel + exact button on camera; demo started |
| 98–110 s | Quick Train in bottom console (Stop not clicked) | **快速训练 / Quick Train** in view, then countdown |
| 110–126 s | Showcase · beds **锁定 locked** | **展示打碟 / Showcase** in view |
| 126–136 s | Outro `npm install && npm run dev` · `:47301` · `github.com/anloren/fly-dj-malecns` | yes |

## Honesty (on camera)

- No claim that neurons compose music.
- CSR frozen called out in footer + ASS.
- Video motive labeled heuristic / 不是果蝇视觉.
- Beds are premade Flow Music loops (pills + muxed wavs).

## Recorder

`node scripts/record-intro-v3.mjs` then `bash scripts/mux-intro-v3.sh`.
