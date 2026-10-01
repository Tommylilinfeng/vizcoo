import { useEffect, useMemo, useRef, useState } from 'react'

export interface AgentTurn {
  id: string
  user: string
  kind: 'chat' | 'workflow'
  status: 'pending' | 'done' | 'error'
  recipe?: string
  reply?: string
  mutation?: { description: string; affectedModuleIds?: number[] }
  error?: string
  durationMs?: number
}

export interface AgentState {
  turns: AgentTurn[]
  pending: boolean
  ccSessionId?: string
}

export const EMPTY_AGENT: AgentState = { turns: [], pending: false }

export interface CommandSpec {
  trigger: string
  label: string
  hint: string
  build: (rest: string) => { recipe: string; params: Record<string, unknown>; summary: string } | { error: string }
}

export interface AgentTabProps {
  subject: string
  subjectDetail: string
  defaultRecipe: string
  state: AgentState
  commands: CommandSpec[]
  onSubmit: (input: SubmitPayload) => void
  onCancel: () => void
  onClear: () => void
}

export interface SubmitPayload {
  raw: string
  recipe: string
  params: Record<string, unknown>
  summary: string
}

export function AgentTab({ subject, subjectDetail, defaultRecipe, state, commands, onSubmit, onCancel, onClear }: AgentTabProps) {
  const [input, setInput] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [state.turns.length, state.pending])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filteredCommands = useMemo(() => {
    if (!input.startsWith('/')) return []
    const q = input.slice(1).split(/\s/)[0] ?? ''
    return commands.filter((c) => c.trigger.startsWith(q))
  }, [input, commands])

  useEffect(() => {
    setMenuOpen(input.startsWith('/') && filteredCommands.length > 0)
  }, [input, filteredCommands.length])

  const submit = () => {
    const text = input.trim()
    if (!text || state.pending) return
    if (text.startsWith('/')) {
      const space = text.indexOf(' ')
      const trigger = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase()
      const rest = space === -1 ? '' : text.slice(space + 1).trim()
      const cmd = commands.find((c) => c.trigger === trigger)
      if (!cmd) return
      const built = cmd.build(rest)
      if ('error' in built) return
      onSubmit({ raw: text, recipe: built.recipe, params: built.params, summary: built.summary })
    } else {
      const params = defaultRecipe === 'agent'
        ? { message: text }
        : { question: text }
      onSubmit({ raw: text, recipe: defaultRecipe, params, summary: text.slice(0, 80) })
    }
    setInput('')
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') setMenuOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div ref={scrollRef} className="flex-1 min-h-[200px] space-y-3 overflow-y-auto rounded-md border border-hairline bg-surface-1 p-3">
        {state.turns.length === 0 && !state.pending && (
          <div className="px-2 py-6 text-center text-[11.5px] leading-relaxed text-fg-deco">
            Talk to <span className="text-fg-dim">{subject}</span> <span className="text-fg-deco">({subjectDetail})</span>.
            <br />
            Type a question{commands.length > 0 ? <>, or <span className="font-mono text-fg-faint">/</span> for actions</> : ''}.
          </div>
        )}
        {state.turns.map((t) => <TurnView key={t.id} turn={t} />)}
      </div>

      <div className="relative">
        {menuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-md border border-hairline-strong bg-surface-2 shadow-[var(--shadow-popover)]">
            {filteredCommands.map((c) => (
              <button
                key={c.trigger}
                onClick={() => { setInput(`/${c.trigger} `); inputRef.current?.focus() }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] text-fg-muted transition hover:bg-interactive hover:text-fg"
              >
                <span className="font-mono">/{c.label}</span>
                <span className="truncate text-[11px] text-fg-faint">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={state.pending ? 'thinking…' : 'ask, or "/" for actions — Enter to send'}
          disabled={state.pending}
          className="min-h-[64px] w-full resize-y rounded-md bg-surface-2 px-2 py-1.5 text-[12.5px] text-fg ring-1 ring-inset ring-hairline-strong placeholder:text-fg-deco focus:outline-none focus:ring-focus disabled:opacity-60"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={state.pending || !input.trim()}
          className="flex-1 rounded-md bg-cta px-3 py-1.5 text-[12.5px] font-medium text-cta-fg transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-interactive-active disabled:text-fg-deco"
        >Send</button>
        {state.pending && (
          <button
            onClick={onCancel}
            className="rounded-md bg-accent-warn/10 px-3 py-1.5 text-[12.5px] text-accent-warn ring-1 ring-inset ring-accent-warn/30 transition hover:bg-accent-warn/15"
          >Stop</button>
        )}
        {state.turns.length > 0 && !state.pending && (
          <button
            onClick={onClear}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-fg-faint transition hover:bg-interactive hover:text-fg"
          >Clear</button>
        )}
      </div>
    </div>
  )
}

function TurnView({ turn }: { turn: AgentTurn }) {
  if (turn.kind === 'chat') return <ChatTurn turn={turn} />
  return <WorkflowTurn turn={turn} />
}

function ChatTurn({ turn }: { turn: AgentTurn }) {
  return (
    <div className="space-y-1.5">
      <Bubble role="user">{turn.user}</Bubble>
      {turn.status === 'pending' && <Thinking />}
      {turn.status === 'done' && turn.reply && <Bubble role="assistant">{turn.reply}</Bubble>}
      {turn.status === 'error' && (
        <div className="rounded-md bg-accent-danger/10 px-2 py-1.5 text-[11px] text-accent-danger ring-1 ring-inset ring-accent-danger/30">{turn.error}</div>
      )}
    </div>
  )
}

function WorkflowTurn({ turn }: { turn: AgentTurn }) {
  const isPending = turn.status === 'pending'
  const isError = turn.status === 'error'
  return (
    <div className="rounded-md bg-interactive px-3 py-2 ring-1 ring-inset ring-hairline">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] text-fg-dim">{turn.user}</span>
        {turn.durationMs !== undefined && (
          <span className="font-mono text-[10.5px] tabular-nums text-fg-deco">{(turn.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        {isPending && <span className="inline-flex items-center gap-1 text-fg-faint"><Spinner /> Running…</span>}
        {isError && <span className="text-accent-danger">{turn.error}</span>}
        {turn.status === 'done' && turn.mutation && (
          <span className="text-fg">✓ {turn.mutation.description}</span>
        )}
        {turn.status === 'done' && !turn.mutation && turn.reply && (
          <span className="text-fg-muted">{turn.reply}</span>
        )}
      </div>
    </div>
  )
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={[
        'max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
        isUser
          ? 'bg-interactive text-fg ring-1 ring-inset ring-focus'
          : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-hairline-strong',
      ].join(' ')}>
        {children}
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-fg-faint ring-1 ring-inset ring-hairline-strong">
        <span className="inline-flex gap-0.5">
          <span className="animate-pulse">·</span>
          <span className="animate-pulse [animation-delay:150ms]">·</span>
          <span className="animate-pulse [animation-delay:300ms]">·</span>
        </span>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg width={10} height={10} viewBox="0 0 50 50" className="animate-spin text-fg-faint">
      <circle cx={25} cy={25} r={20} stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeDasharray="80 200" fill="none" />
    </svg>
  )
}
