# Fly DJ intro v3 — VERIFY

Captured 2026-09-15 against `main` @ `7759565` (bed pills + video motive + MaleCNS CSR).

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
| App build | `npm run build` OK (tsc + vite) |

## Chrome / Translate

Launch flags: `--disable-features=Translate,TranslateUI --lang=zh-CN --accept-lang=zh-CN --disable-translate` + kiosk 1280×720.

Page preflight (before REC):

```json
{"lang":"zh-CN","translate":"no","bodyNo":true,"boot":false,"nodes":true,"edges":true,"translateBar":false}
```

No Google Translate infobar in any sampled frame.

## LIF / counts

Waited until `.boot` gone. On-screen **164,506** nodes / **10.35M** edges (manifest 10,349,880). CSR gzip present.

## Shot clock (sampled frames)

| t | Shot | Present |
| --- | --- | --- |
| 0–5 s | Title overlay 果蝇中枢 DJ / FLY DJ / MaleCNS v1.0 | yes |
| 5–14 s | Honesty zoom-out + top stats 164,506 / 10.35M | yes |
| 14–30 s | Left connectome lock (soma heat + raster) | yes, ≥14 s |
| 30–46 s | Right booth + 6-leg fly (XF / FLT A / LOW / FLT B / MST / PUNCH) | yes; brief canvas refresh at the 30 s cut |
| 46–56 s | Console · RL · knobs | yes |
| 56–74 s | Bed pills Techno 120 → Glitch 110 → Breakbeat 140 | clicks logged; Techno then swap |
| 74–98 s | Video motive ON · 20s test pattern (black quiet → flash → shake) · visual/mechano/sensory_other · 「不是果蝇视觉」 | yes |
| 98–110 s | Quick Train (Stop shown, not clicked) · reward chart · beds **锁定 locked** | yes |
| 110–126 s | Showcase banner + Heuristic 8s callout + booth | yes |
| 126–136 s | Outro `npm install && npm run dev` · `:47301` · `github.com/anloren/fly-dj-malecns` | yes |

## Honesty (on camera)

- No claim that neurons compose music.
- CSR frozen called out in footer + ASS.
- Video motive labeled heuristic / 不是果蝇视觉.
- Beds are premade Flow Music loops (pills + muxed wavs).

## Recorder

`node scripts/record-intro-v3.mjs` then `bash scripts/mux-intro-v3.sh`.
