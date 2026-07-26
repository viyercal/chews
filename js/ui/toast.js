let root

export function initToast(el) {
  root = el
}

export function clearToasts() {
  if (root) root.innerHTML = ''
}

export function toast(msg, { ms = 1600 } = {}) {
  if (!root) return
  // Cap the stack: rapid swipes must never wallpaper the screen in toasts.
  while (root.children.length >= 2) root.firstElementChild.remove()
  const last = root.lastElementChild
  if (last && last.textContent === msg) last.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  root.appendChild(t)
  requestAnimationFrame(() => t.classList.add('show'))
  setTimeout(() => {
    t.classList.remove('show')
    setTimeout(() => t.remove(), 350)
  }, ms)
}
