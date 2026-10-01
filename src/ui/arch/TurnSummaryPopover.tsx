import type { Module, TurnSummary } from '../api.js'

export function TurnSummaryPopover({
  summary, modules, onClose,
}: {
  summary: TurnSummary
  modules: Module[]
  onClose: () => void
}) {
  const m = modules.find((x) => x.id === summary.moduleId)
  const name = m?.displayName ?? m?.name ?? `module ${summary.moduleId}`
  return (
    <div className="fixed left-1/2 top-1/2 z-[80] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-hairline-strong bg-surface-2/95 p-5 shadow-2xl backdrop-blur" style={{ minWidth: 380, maxWidth: 520 }}>
      <button onClick={onClose} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md border border-hairline-strong bg-interactive text-fg-faint hover:text-fg">×</button>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-deco">
        turn {summary.turnIndex} · {summary.finalized ? 'finalized' : 'in progress'}
      </div>
      <div className="mb-3 font-sans text-base font-medium text-fg">{name}</div>
      <div className="mb-4 font-sans text-sm text-fg-muted">{summary.summary}</div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-deco">
        files ({summary.filePaths.length})
      </div>
      <div className="flex flex-col gap-1">
        {summary.filePaths.map((p, i) => (
          <div key={i} className="truncate rounded-sm bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-dim" title={p}>{p}</div>
        ))}
      </div>
    </div>
  )
}
