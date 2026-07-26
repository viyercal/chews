// Pointer-driven swipe physics for the top card: drag with rotation, stamp
// opacity via CSS vars, velocity- or distance-committed flings, tap detection.
export class SwipeController {
  constructor(card, { onLeft, onRight, onTap } = {}) {
    this.card = card
    this.h = { onLeft, onRight, onTap }
    this.active = false
    this.done = false
    this.dx = 0
    this.dy = 0
    this.moved = 0
    this.vx = 0
    card.style.touchAction = 'none'
    this._down = (e) => this.down(e)
    this._move = (e) => this.move(e)
    this._up = (e) => this.up(e)
    this._cancel = (e) => {
      if (this.active && e.pointerId === this.pointerId) this.settleBack()
    }
    card.addEventListener('pointerdown', this._down)
    card.addEventListener('pointermove', this._move)
    card.addEventListener('pointerup', this._up)
    card.addEventListener('pointercancel', this._cancel)
  }

  down(e) {
    // One drag, one pointer: ignore extra touches, non-primary mouse buttons,
    // and anything while a drag is already live.
    if (this.done || this.active || !e.isPrimary || e.button !== 0) return
    this.active = true
    this.pointerId = e.pointerId
    this.moved = 0
    this.dx = 0
    this.dy = 0
    this.vx = 0
    this.startX = e.clientX
    this.startY = e.clientY
    this.startT = performance.now()
    this.lastX = e.clientX
    this.lastT = this.startT
    try { this.card.setPointerCapture(e.pointerId) } catch {}
    this.card.classList.add('dragging')
  }

  move(e) {
    if (!this.active || this.done || e.pointerId !== this.pointerId) return
    this.dx = e.clientX - this.startX
    this.dy = e.clientY - this.startY
    const now = performance.now()
    if (now - this.lastT > 0) {
      this.vx = (e.clientX - this.lastX) / (now - this.lastT)
      this.lastX = e.clientX
      this.lastT = now
    }
    this.moved = Math.max(this.moved, Math.hypot(this.dx, this.dy))
    this.card.style.transform = `translate(${this.dx}px, ${this.dy * 0.35}px) rotate(${this.dx / 18}deg)`
    const p = Math.min(1, Math.abs(this.dx) / 90)
    this.card.style.setProperty('--yum-o', this.dx > 0 ? p : 0)
    this.card.style.setProperty('--pass-o', this.dx < 0 ? p : 0)
  }

  up(e) {
    if (!this.active || this.done || e.pointerId !== this.pointerId) return
    this.active = false
    this.card.classList.remove('dragging')
    const dur = performance.now() - this.startT
    if (this.moved < 8 && dur < 400) {
      this.settleBack()
      this.h.onTap?.()
      return
    }
    // A flick's velocity only counts if the pointer was still moving at
    // release — holding still to reconsider must not commit a stale fling.
    const vx = performance.now() - this.lastT < 100 ? this.vx : 0
    const w = this.card.offsetWidth || 320
    const byDistance = Math.abs(this.dx) > w * 0.32
    const byVelocity = Math.abs(vx) > 0.65
    if (byDistance) this.fling(this.dx > 0 ? 1 : -1)
    else if (byVelocity) this.fling(vx > 0 ? 1 : -1) // direction follows the flick
    else this.settleBack()
  }

  settleBack() {
    this.active = false
    this.card.classList.remove('dragging')
    this.card.style.transform = ''
    this.card.style.setProperty('--yum-o', 0)
    this.card.style.setProperty('--pass-o', 0)
  }

  fling(dir) {
    if (this.done) return
    this.done = true
    try { navigator.vibrate?.(12) } catch {}
    this.card.classList.remove('dragging')
    this.card.classList.add('flinging')
    this.card.style.setProperty('--yum-o', dir > 0 ? 1 : 0)
    this.card.style.setProperty('--pass-o', dir < 0 ? 1 : 0)
    const x = dir * (window.innerWidth + 240)
    this.card.style.transform = `translate(${x}px, ${this.dy * 0.35 - 40}px) rotate(${dir * 22}deg)`
    // State commits synchronously; the flying card is a visual ghost from here.
    ;(dir > 0 ? this.h.onRight : this.h.onLeft)?.()
  }

  destroy() {
    this.done = true
    this.card.removeEventListener('pointerdown', this._down)
    this.card.removeEventListener('pointermove', this._move)
    this.card.removeEventListener('pointerup', this._up)
    this.card.removeEventListener('pointercancel', this._cancel)
  }
}
