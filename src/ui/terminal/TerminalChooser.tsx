import { useEffect, useRef, useState } from 'react'
import type { Effort, LaunchOptions } from './launch-options.js'

interface ConvSummary {
  id: string
  title: string
  createdAt: number
  lastActivity: number
  turnCount: number
  fileCount: number
  status: 'alive' | 'dead'
}

const MODEL_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Default' },
  { value: 'opus', label: 'Opus 4.7' },
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
]

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
]

type Perm = 'default' | 'plan' | 'skip'
const PERM_OPTIONS: { value: Perm; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'skip', label: 'Skip' },
]

function permFromBools(skip: boolean, plan: boolean): Perm {
  if (skip) return 'skip'
  if (plan) return 'plan'
  return 'default'
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

export function TerminalChooser({ onLaunch, activeConvIds, exitingIds }: { onLaunch: (opts: LaunchOptions) => void; activeConvIds: ReadonlySet<string>; exitingIds: ReadonlySet<string> }) {
  const [convs, setConvs] = useState<ConvSummary[] | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [effort, setEffort] = useState<Effort | null>(null)
  const [permissions, setPermissions] = useState<Perm>('default')
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reloadConvsRef = useRef<() => void>(() => {})

  useEffect(() => {
    const loadConvs = () => fetch('/api/conversations')
      .then((r) => r.json() as Promise<{ conversations: ConvSummary[] }>)
      .then((j) => setConvs(j.conversations))
      .catch(() => { /* keep stale list on transient error */ })
    reloadConvsRef.current = loadConvs
    void loadConvs()
    void fetch('/api/launcher/prefs').then((r) => r.json() as Promise<{ model: string | null; effort: Effort | null; skipPermissions: boolean; planMode: boolean }>).then((p) => {
      setModel(p.model)
      setEffort(p.effort)
      setPermissions(permFromBools(p.skipPermissions, p.planMode))
      setPrefsLoaded(true)
    })
    const id = window.setInterval(() => {
      if (document.hidden) return
      void loadConvs()
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  const launchAndRefresh = (opts: LaunchOptions) => {
    onLaunch(opts)
    window.setTimeout(() => reloadConvsRef.current(), 500)
    window.setTimeout(() => reloadConvsRef.current(), 1500)
  }

  const skipPermissions = permissions === 'skip'
  const planMode = permissions === 'plan'

  useEffect(() => {
    if (!prefsLoaded) return
    void fetch('/api/launcher/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, effort, skipPermissions, planMode }),
    })
  }, [prefsLoaded, model, effort, skipPermissions, planMode])

  const startNew = () => {
    const trimmed = prompt.trim()
    launchAndRefresh({ model, effort, skipPermissions, planMode, resumeId: null, initialPrompt: trimmed || undefined })
  }

  const all = convs ?? []
  const working = all.filter((c) => c.status === 'alive' && !exitingIds.has(c.id))
  const resume = all.filter((c) => c.status === 'dead' && !activeConvIds.has(c.id) && !exitingIds.has(c.id))

  return (
    <div className="absolute inset-0 flex flex-col bg-surface-0 font-mono">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div>
          <header className="mb-6 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium text-fg">vizcoo</div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-faint">
                {working.length} working · {resume.length} resumable
              </div>
            </div>
          </header>

          {working.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-faint">Working</h3>
              <div className="flex flex-col gap-px">
                {working.map((c) => (
                  <SessionRow key={c.id} c={c} disabled hint="running" />
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-faint">Resume</h3>
            {convs === null && <div className="text-[12.5px] text-fg-faint">Loading…</div>}
            {convs !== null && resume.length === 0 && <div className="text-[12.5px] text-fg-faint">No previous conversations.</div>}
            {resume.length > 0 && (
              <div className="flex flex-col gap-px">
                {resume.map((c) => (
                  <SessionRow
                    key={c.id}
                    c={c}
                    onClick={() => launchAndRefresh({ model, effort, skipPermissions, planMode, resumeId: c.id })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline bg-surface-0">
        <div className="px-6 pb-5 pt-4">
          <div className="rounded-lg border border-hairline-strong bg-surface-1 px-3 py-2.5 transition focus-within:border-fg-faint">
            <div className="flex items-start gap-2">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startNew() }
                }}
                placeholder="describe a task for a new session"
                rows={1}
                autoFocus
                className="min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-fg placeholder:text-fg-deco focus:outline-none"
              />
              <button
                onClick={startNew}
                aria-label="Start session"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition hover:bg-interactive hover:text-fg"
              >
                <EnterIcon />
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[12px]">
            <SectionedSelect
              trigger={PERM_OPTIONS.find((o) => o.value === permissions)?.label ?? 'Default'}
              sections={[
                {
                  items: PERM_OPTIONS.map((o) => ({
                    label: o.label,
                    selected: o.value === permissions,
                    onSelect: () => setPermissions(o.value),
                  })),
                },
              ]}
            />
            <button
              onClick={() => inputRef.current?.focus()}
              aria-label="Attach"
              className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition hover:bg-interactive hover:text-fg"
            >
              <PlusIcon />
            </button>
            <SectionedSelect
              className="ml-auto"
              align="right"
              trigger={modelEffortTrigger(model, effort)}
              sections={[
                {
                  label: 'Models',
                  items: MODEL_OPTIONS.map((o) => ({
                    label: o.label,
                    selected: Object.is(o.value, model),
                    onSelect: () => setModel(o.value),
                  })),
                },
                {
                  label: 'Effort',
                  items: EFFORT_OPTIONS.map((o) => ({
                    label: o.label,
                    selected: o.value === effort,
                    onSelect: () => setEffort(o.value),
                  })),
                },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function EnterIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M13 4v3a2 2 0 0 1-2 2H3.5" />
      <path d="m6 6.5-2.5 2.5L6 11.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

function SessionRow({ c, onClick, disabled, hint }: { c: ConvSummary; onClick?: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-3 rounded px-2 py-1.5 text-left transition hover:bg-interactive focus-visible:bg-interactive focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className={`shrink-0 font-mono text-[11px] ${c.status === 'alive' ? 'text-accent-warn' : 'text-fg-deco'}`}>*</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted" title={c.title}>{c.title || '(no title)'}</span>
      {hint && <span className="shrink-0 text-[11px] text-accent-warn">{hint}</span>}
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-fg-faint">{timeAgo(c.lastActivity)}</span>
    </button>
  )
}

function modelEffortTrigger(model: string | null, effort: Effort | null): string {
  const modelLabel = MODEL_OPTIONS.find((o) => Object.is(o.value, model))?.label ?? 'Default'
  const effortLabel = effort ? EFFORT_OPTIONS.find((o) => o.value === effort)?.label : null
  return effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel
}

interface SectionedItem {
  label: string
  suffix?: string
  selected: boolean
  onSelect: () => void
}

interface SectionedGroup {
  label?: string
  items: SectionedItem[]
}

function SectionedSelect({ trigger, sections, align = 'left', className = '' }: {
  trigger: string
  sections: SectionedGroup[]
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] text-fg-muted transition-colors hover:text-fg"
      >
        {trigger}
        <span className="text-fg-faint">▾</span>
      </button>
      {open && (
        <div className={`absolute bottom-full z-10 mb-2 min-w-[240px] overflow-hidden rounded-lg border border-hairline bg-surface-2 py-2 shadow-[var(--shadow-popover)] ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {sections.map((s, si) => (
            <div key={si}>
              {si > 0 && <div className="my-2 border-t border-hairline" />}
              {s.label && (
                <div className="px-3 pt-1 pb-1.5 text-[13px] text-fg-dim">{s.label}</div>
              )}
              <div className="px-2">
                {s.items.map((it, ii) => (
                  <button
                    key={ii}
                    type="button"
                    onClick={() => { it.onSelect(); setOpen(false) }}
                    className={[
                      'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors',
                      it.selected ? 'bg-interactive-active' : 'hover:bg-interactive',
                    ].join(' ')}
                  >
                    <span className="text-[15px] text-fg">
                      {it.label}
                      {it.suffix && <span className="ml-1.5 text-fg-faint">{it.suffix}</span>}
                    </span>
                    {it.selected && <span className="ml-auto shrink-0"><CheckIcon /></span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-fg">
      <polyline points="3.5 8 6.5 11 12.5 5" />
    </svg>
  )
}
