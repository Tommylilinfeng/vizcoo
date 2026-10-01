import type { Terminal } from '@xterm/xterm'

const BLOCKED_META_KEYS = new Set(['w', 'r', 't', 'n'])

export interface KeybindOptions {
  onPaste: () => void
}

export function installKeybinds(term: Terminal, opts: KeybindOptions): void {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const key = e.key.toLowerCase()
    const onlyMeta = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    const onlyCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    if ((onlyMeta || onlyCtrl) && key === 'v') {
      e.preventDefault()
      opts.onPaste()
      return false
    }
    if (onlyMeta && BLOCKED_META_KEYS.has(key)) {
      e.preventDefault()
      return false
    }
    return true
  })
}
