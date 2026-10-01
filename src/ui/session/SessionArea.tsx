import { useEffect, useMemo, useRef, useState } from 'react'
import { SessionCard } from './SessionCard.js'
import { useViewStore } from '../view/viewStore.js'
import type { LaunchOptions } from '../terminal/launch-options.js'

interface Card { id: string; opts: LaunchOptions | null }

const CARD_MIN_PCT = 0.25
const CARD_MAX_PCT = 0.75
const SPLIT_KEY = 'vizcoo.sessionSplitPct'

function readSplitPct(): number {
  if (typeof window === 'undefined') return 0.5
  const raw = Number(window.localStorage.getItem(SPLIT_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return 0.5
  return Math.min(CARD_MAX_PCT, Math.max(CARD_MIN_PCT, raw))
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9)
}

const EXITING_TTL_MS = 4000

export function SessionArea() {
  const [cards, setCards] = useState<Card[]>(() => [{ id: newId(), opts: null }])
  const [focusedId, setFocusedId] = useState<string>(() => cards[0]?.id ?? '')
  const [splitPct, setSplitPct] = useState<number>(readSplitPct)
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(() => new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const markExiting = (convId: string) => {
    setExitingIds((prev) => {
      if (prev.has(convId)) return prev
      const next = new Set(prev)
      next.add(convId)
      return next
    })
    window.setTimeout(() => {
      setExitingIds((prev) => {
        if (!prev.has(convId)) return prev
        const next = new Set(prev)
        next.delete(convId)
        return next
      })
    }, EXITING_TTL_MS)
  }

  useEffect(() => { window.localStorage.setItem(SPLIT_KEY, String(splitPct)) }, [splitPct])

  useEffect(() => {
    if (!cards.some((c) => c.id === focusedId) && cards[0]) {
      setFocusedId(cards[0].id)
    }
  }, [cards, focusedId])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      setSplitPct(Math.min(CARD_MAX_PCT, Math.max(CARD_MIN_PCT, pct)))
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onSplit = () => {
    if (cards.length >= 2) return
    const fresh = { id: newId(), opts: null }
    setCards([...cards, fresh])
    setFocusedId(fresh.id)
  }

  const onClose = (id: string) => {
    const closing = cards.find((c) => c.id === id)
    if (closing?.opts?.resumeId) markExiting(closing.opts.resumeId)
    if (cards.length <= 1) {
      const fresh = { id: newId(), opts: null }
      setCards([fresh])
      setFocusedId(fresh.id)
      return
    }
    const next = cards.filter((c) => c.id !== id)
    setCards(next)
    if (focusedId === id && next[0]) setFocusedId(next[0].id)
  }

  const onLaunch = (cardId: string, opts: LaunchOptions) => {
    if (opts.resumeId) void useViewStore.getState().selectConversation(opts.resumeId)
    const other = cards.find((c) => c.id !== cardId)
    if (other) {
      if (other.opts?.resumeId && other.opts.resumeId !== opts.resumeId) markExiting(other.opts.resumeId)
      setCards((prev) => prev.map((c) => c.id === other.id ? { ...c, opts } : c))
      setFocusedId(other.id)
    } else {
      const fresh = { id: newId(), opts }
      setCards((prev) => [...prev, fresh])
      setFocusedId(fresh.id)
    }
  }

  const onExit = (id: string) => {
    const card = cards.find((c) => c.id === id)
    if (card?.opts?.resumeId) markExiting(card.opts.resumeId)
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, opts: null } : c))
  }

  const activeConvIds = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) {
      if (c.opts?.resumeId) s.add(c.opts.resumeId)
    }
    return s
  }, [cards])

  if (cards.length === 1) {
    const c = cards[0]!
    return (
      <div ref={containerRef} className="flex h-full w-full">
        <SessionCard
          cardId={c.id}
          opts={c.opts}
          focused
          showSplit
          activeConvIds={activeConvIds}
          exitingIds={exitingIds}
          onFocus={() => setFocusedId(c.id)}
          onSplit={onSplit}
          onClose={() => onClose(c.id)}
          onLaunch={(o) => onLaunch(c.id, o)}
          onExit={() => onExit(c.id)}
        />
      </div>
    )
  }

  const [a, b] = cards as [Card, Card]
  return (
    <div ref={containerRef} className="flex h-full w-full">
      <div style={{ width: `${splitPct * 100}%` }} className="relative h-full shrink-0">
        <SessionCard
          cardId={a.id}
          opts={a.opts}
          focused={focusedId === a.id}
          showSplit={false}
          activeConvIds={activeConvIds}
          exitingIds={exitingIds}
          onFocus={() => setFocusedId(a.id)}
          onSplit={onSplit}
          onClose={() => onClose(a.id)}
          onLaunch={(o) => onLaunch(a.id, o)}
          onExit={() => onExit(a.id)}
        />
      </div>
      <div
        onMouseDown={startDrag}
        onDoubleClick={() => setSplitPct(0.5)}
        title="Drag to resize · double-click to reset"
        className="relative w-px shrink-0 cursor-col-resize bg-hairline transition-colors hover:bg-fg-faint"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      <div className="relative h-full flex-1 min-w-0">
        <SessionCard
          cardId={b.id}
          opts={b.opts}
          focused={focusedId === b.id}
          showSplit={false}
          activeConvIds={activeConvIds}
          exitingIds={exitingIds}
          onFocus={() => setFocusedId(b.id)}
          onSplit={onSplit}
          onClose={() => onClose(b.id)}
          onLaunch={(o) => onLaunch(b.id, o)}
          onExit={() => onExit(b.id)}
        />
      </div>
    </div>
  )
}
