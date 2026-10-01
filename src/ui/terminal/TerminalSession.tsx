import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { createTerminal, resolveTermTheme, TERM_THEME_EVENT } from './xterm-setup.js'
import { installKeybinds } from './keybinds.js'
import { readClipboardImage, readClipboardText, uploadImage } from './clipboard-image.js'
import { buildPtyUrl, type LaunchOptions } from './launch-options.js'

function useEffectiveTermTheme() {
  const [theme, setTheme] = useState(() => resolveTermTheme())
  useEffect(() => {
    const update = () => setTheme(resolveTermTheme())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener(TERM_THEME_EVENT, update)
    return () => { mo.disconnect(); window.removeEventListener(TERM_THEME_EVENT, update) }
  }, [])
  return theme
}

export function TerminalSession({ opts, onExit }: { opts: LaunchOptions; onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const onExitRef = useRef(onExit)
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  const effectiveTheme = useEffectiveTermTheme()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let unmounted = false
    let exitTimer: number | undefined
    let ws: WebSocket | null = null
    let dataDisp: { dispose(): void } | null = null
    let ro: ResizeObserver | null = null

    const { term, fit, dispose } = createTerminal(resolveTermTheme())
    termRef.current = term
    term.open(container)

    const handlePaste = async () => {
      try {
        const blob = await readClipboardImage()
        if (blob) { term.paste(await uploadImage(blob)); return }
        const text = await readClipboardText()
        if (text) term.paste(text)
      } catch (err) { console.error('[vizcoo] paste failed', err) }
    }
    installKeybinds(term, { onPaste: () => void handlePaste() })

    const handleDragOver = (e: DragEvent) => { e.preventDefault() }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer?.files[0]
      if (!file) return
      void (async () => {
        try { term.paste(await uploadImage(file)) }
        catch (err) { console.error('[vizcoo] drop upload failed', err) }
      })()
    }
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!ws || ws.readyState !== 1) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    const fitWithMargin = () => {
      try {
        fit.fit()
        if (term.cols > 20) term.resize(term.cols - 1, term.rows)
      } catch { /* container detached */ }
    }

    const initFrame = requestAnimationFrame(() => {
      if (unmounted) return
      fitWithMargin()

      const sock = new WebSocket(buildPtyUrl(opts, { cols: term.cols, rows: term.rows }))
      ws = sock

      const sendResize = () => {
        if (sock.readyState !== 1) return
        sock.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }

      sock.addEventListener('open', () => {
        sendResize()
        term.focus()
        if (opts.initialPrompt) {
          const prompt = opts.initialPrompt
          window.setTimeout(() => { if (!unmounted) term.paste(prompt) }, 1000)
        }
      })
      sock.addEventListener('message', (e) => { if (typeof e.data === 'string') term.write(e.data) })
      sock.addEventListener('close', () => {
        if (unmounted) return
        term.write('\r\n\x1b[2m[session ended — returning to launcher…]\x1b[0m\r\n')
        exitTimer = window.setTimeout(() => { if (!unmounted) onExitRef.current() }, 800)
      })

      dataDisp = term.onData((d) => { if (sock.readyState === 1) sock.send(d) })

      let resizeTimer: number | undefined
      ro = new ResizeObserver(() => {
        fitWithMargin()
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(() => { sendResize() }, 80)
      })
      ro.observe(container)
    })

    return () => {
      unmounted = true
      cancelAnimationFrame(initFrame)
      if (exitTimer) window.clearTimeout(exitTimer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
      ro?.disconnect()
      dataDisp?.dispose()
      if (ws) try { ws.close() } catch { /* already closed */ }
      termRef.current = null
      dispose()
    }
  }, [opts])

  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.theme = effectiveTheme
    t.refresh(0, t.rows - 1)
  }, [effectiveTheme])

  return <div ref={containerRef} className="absolute inset-0 bg-surface-0 p-2" />
}
