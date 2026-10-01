import { useState } from 'react'
import type { Module, ModuleRelation, RelationCategory, RelationDirection } from '../api.js'
import { regenerateRelations } from '../api.js'
import { AgentTab, type AgentState, type SubmitPayload } from './AgentTab.js'

const CATEGORY_COLOR: Record<RelationCategory, string> = {
  depends: '#e5e5e5', shares: '#5dd6a8', observes: '#f5b85a', contracts: '#a3a3a3',
}

const DIRECTION_LABEL: Record<RelationDirection, string> = {
  a_to_b: '→', b_to_a: '←', both: '↔', shared: '·',
}

export function RelationDetailPanel({
  relation, modules, agent, onClose, onRegenerated, onAgentSubmit, onCancelAgent, onClearAgent,
}: {
  relation: ModuleRelation
  modules: Module[]
  agent: AgentState
  onClose: () => void
  onRegenerated: () => void
  onAgentSubmit: (input: SubmitPayload) => void
  onCancelAgent: () => void
  onClearAgent: () => void
}) {
  const [tab, setTab] = useState<'ask' | 'info'>('ask')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const a = modules.find((m) => m.id === relation.moduleAId)
  const b = modules.find((m) => m.id === relation.moduleBId)
  const aName = a?.displayName ?? a?.name ?? `module ${relation.moduleAId}`
  const bName = b?.displayName ?? b?.name ?? `module ${relation.moduleBId}`
  const stale = relation.fingerprintCurrent !== null && relation.fingerprintCurrent !== relation.fingerprint
  const color = CATEGORY_COLOR[relation.category]
  const subject = `${aName} ${DIRECTION_LABEL[relation.direction]} ${bName}`

  const handleRegenerate = async () => {
    setBusy(true); setError(null)
    try {
      await regenerateRelations([`${relation.moduleAId}:${relation.moduleBId}`])
      onRegenerated()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <aside className="fixed right-0 top-0 z-[70] flex h-screen w-[360px] flex-col overflow-y-auto border-l border-hairline-strong bg-surface-1/95 backdrop-blur">
      <button onClick={onClose} className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-md text-fg-faint hover:bg-interactive hover:text-fg">×</button>

      <header className="flex flex-col gap-2 px-5 pb-5 pt-5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider" style={{ color }}>
          <span>{relation.category}</span>
          {stale && <span className="text-accent-warn">stale</span>}
          {relation.manualOverride && <span className="text-fg-dim">manual</span>}
        </div>
        <div className="flex items-baseline gap-2 pr-7 text-[16px] font-medium leading-tight text-fg">
          <span className="truncate">{aName}</span>
          <span className="text-fg-faint">{DIRECTION_LABEL[relation.direction]}</span>
          <span className="truncate">{bName}</span>
        </div>
        <div className="text-[12.5px] leading-relaxed text-fg-muted">{relation.label}</div>
      </header>

      <div className="flex gap-1 border-b border-hairline px-5">
        <TabBtn active={tab === 'ask'} onClick={() => setTab('ask')}>Agent</TabBtn>
        <TabBtn active={tab === 'info'} onClick={() => setTab('info')}>Info</TabBtn>
      </div>

      {tab === 'ask' && (
        <div className="flex flex-1 flex-col px-5 py-5">
          <AgentTab
            subject={subject}
            subjectDetail={relation.category}
            defaultRecipe="ask-relation"
            state={agent}
            commands={[]}
            onSubmit={onAgentSubmit}
            onCancel={onCancelAgent}
            onClear={onClearAgent}
          />
        </div>
      )}

      {tab === 'info' && (
        <div className="flex flex-1 flex-col gap-5 px-5 py-5">
          <Field label="Summary">{relation.summary}</Field>
          <Field label={`Evidence (${relation.evidenceFiles.length})`}>
            {relation.evidenceFiles.length === 0
              ? <span className="font-mono text-[11px] italic text-fg-deco">(none)</span>
              : <div className="flex flex-col gap-1">
                  {relation.evidenceFiles.map((f, i) => (
                    <div key={i} className="truncate rounded-sm bg-interactive px-2 py-1 font-mono text-[11px] text-fg-dim" title={f}>{f}</div>
                  ))}
                </div>
            }
          </Field>

          <div className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4">
            <button
              onClick={() => void handleRegenerate()}
              disabled={busy}
              className="rounded-md bg-interactive px-3 py-2 text-[12.5px] text-fg ring-1 ring-inset ring-hairline-strong transition hover:bg-interactive-active hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'regenerating…' : (stale ? 'Regenerate (refresh stale)' : 'Regenerate')}
            </button>
            {error && <div className="rounded bg-accent-danger/10 px-2 py-1 font-mono text-[11px] text-accent-danger">{error}</div>}
          </div>
        </div>
      )}
    </aside>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        '-mb-px border-b-2 px-1 py-2.5 text-[12.5px] transition',
        active ? 'border-fg text-fg' : 'border-transparent text-fg-faint hover:text-fg',
      ].join(' ')}
    >{children}</button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-medium text-fg-dim">{label}</div>
      <div className="text-[12.5px] leading-relaxed text-fg-muted">{children}</div>
    </section>
  )
}
