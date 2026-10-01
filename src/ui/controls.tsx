import { useEffect, useRef, useState } from 'react'

export function SegItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-[5px] px-2.5 py-1 text-[12.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
        (active
          ? 'bg-interactive-active text-fg shadow-[var(--shadow-inset-highlight)]'
          : 'text-fg-faint hover:bg-interactive hover:text-fg')
      }
    >
      {children}
    </button>
  )
}

export interface SelectOption<T> { value: T; label: string; hint?: string }

export function Select<T>({ value, options, onChange }: { value: T; options: SelectOption<T>[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => Object.is(o.value, value))

  useEffect(() => {
    if (!open) return
    setHighlighted(Math.max(0, options.findIndex((o) => Object.is(o.value, value))))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, options.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = options[highlighted]
        if (opt) { onChange(opt.value); setOpen(false) }
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, options, highlighted, onChange])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] text-fg ring-1 ring-inset ring-hairline-strong transition hover:ring-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="flex items-baseline gap-2">
          <span>{current?.label ?? '—'}</span>
          {current?.hint && <span className="text-[11px] text-fg-faint">{current.hint}</span>}
        </span>
        <svg className={'h-3 w-3 text-fg-faint transition ' + (open ? 'rotate-180' : '')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-hairline-strong bg-surface-2 shadow-[var(--shadow-popover)]">
          {options.map((o, i) => {
            const selected = Object.is(o.value, value)
            const isHi = i === highlighted
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={
                  'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] transition focus:outline-none ' +
                  (isHi ? 'bg-interactive-hover ' : '') +
                  (selected ? 'text-fg' : 'text-fg-muted')
                }
              >
                <span className="flex items-baseline gap-2">
                  <span>{o.label}</span>
                  {o.hint && <span className="text-[11px] text-fg-faint">{o.hint}</span>}
                </span>
                {selected && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.2 5 8.5l4.5-5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
