/** 20s honesty-bar test: black quiet → flash punch → shake motion → black. */
export const DEMO_SECONDS = 20

export function drawDemoPattern(ctx: CanvasRenderingContext2D, tSec: number, w: number, h: number): void {
  const t = ((tSec % DEMO_SECONDS) + DEMO_SECONDS) % DEMO_SECONDS
  if (t < 6) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (t < 6.28) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (t < 10) {
    ctx.fillStyle = '#6a6e78'
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (t < 12.2) {
    const on = Math.floor(t * 9) % 2 === 0
    ctx.fillStyle = on ? '#f5f7ff' : '#0a0c12'
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (t < 16) {
    const ox = Math.sin(t * 31) * (w * 0.22) + Math.sin(t * 13) * (w * 0.08)
    const oy = Math.cos(t * 27) * (h * 0.2)
    ctx.fillStyle = '#1a2030'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#e8eefc'
    ctx.fillRect(w * 0.12 + ox, h * 0.18 + oy, w * 0.38, h * 0.52)
    ctx.fillStyle = '#3ee0ff'
    ctx.fillRect(w * 0.48 + ox * 0.7, h * 0.28 + oy, w * 0.3, h * 0.36)
    return
  }
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
}
