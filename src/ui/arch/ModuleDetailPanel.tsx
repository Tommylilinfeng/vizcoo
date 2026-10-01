import { useMemo, useState } from 'react'
import type { ModuleEdge, Tier } from '../api.js'
import { patchModuleRequest, deleteModuleRequest, createTierRequest, mergeModulesRequest } from '../api.js'
import type { ArchNode, NodeId } from './types.js'
import { findById } from './tree.js'
import { AgentTab, type AgentState, type CommandSpec, type SubmitPayload } from './AgentTab.js'

export interface ModuleDetailPanelProps {
  node: ArchNode
  edges: ModuleEdge[]
  allNodes: ArchNode[]
  tiers: Tier[]
  splitting: boolean
  agent: AgentState
  onSplit: (count: number | null, hint: string) => void
  onClose: () => void
  onMutate: () => void
  onAgentSubmit: (input: SubmitPayload) => void
  onCancelAgent: () => void
  onClearAgent: () => void
}

export function ModuleDetailPanel({ node, edges, allNodes, tiers, splitting, agent, onSplit, onClose, onMutate, onAgentSubmit, onCancelAgent, onClearAgent }: ModuleDetailPanelProps) {
  const display = node.displayName ?? node.name
  const splittableItems = node.children.length > 0 ? node.children.length : node.fileCount
  const showSplit = splittableItems >= 2

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(display)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(node.description ?? '')
  const [tab, setTab] = useState<'overview' | 'agent'>('agent')
  const [drawer, setDrawer] = useState<null | 'tier' | 'place' | 'split' | 'merge'>(null)
  const [restructureOpen, setRestructureOpen] = useState(false)

  const commands: CommandSpec[] = useMemo(() => {
    const cmds: CommandSpec[] = [
      { trigger: 'ask', label: 'ask', hint: 'Ask a question (default if no /)',
        build: (rest) => rest ? { recipe: 'ask-module', params: { question: rest }, summary: rest.slice(0, 80) } : { error: 'no question' } },
    ]
    if (showSplit) {
      cmds.push({
        trigger: 'split',
        label: `split [N]`,
        hint: `Propose split into N groups (max ${splittableItems})`,
        build: (rest) => {
          const tokens = rest.split(/\s+/).filter(Boolean)
          const num = Number(tokens[0])
          const count = Number.isFinite(num) && num >= 2 ? Math.min(num, splittableItems) : null
          const hint = tokens.slice(count !== null ? 1 : 0).join(' ').trim() || undefined
          if (count === null && !hint) return { error: 'count or hint required' }
          return {
            recipe: 'split-module',
            params: { count, hint },
            summary: count !== null ? `/split ${count}` : '/split (AI count)',
          }
        },
      })
    }
    return cmds
  }, [showSplit, splittableItems])

  const isTopLevel = node.parentId === null
  const sortedTiers = useMemo(() => [...tiers].sort((a, b) => a.position - b.position), [tiers])
  const currentTier = sortedTiers.find((t) => t.id === node.tierId) ?? null
  const moduleCount = node.children.length === 0 ? 1 : countModules(node)

  const saveName = async () => {
    if (nameDraft.trim() === display) { setEditingName(false); return }
    try { await patchModuleRequest(node.id, { displayName: nameDraft.trim() || null }); onMutate() } catch {}
    setEditingName(false)
  }
  const saveDesc = async () => {
    const next = descDraft.trim()
    if (next === (node.description ?? '')) { setEditingDesc(false); return }
    try { await patchModuleRequest(node.id, { description: next || null }); onMutate() } catch {}
    setEditingDesc(false)
  }

  const agentDisabled = node.fileCount === 0

  return (
    <aside className="fixed right-0 top-0 z-[70] flex h-screen w-[360px] flex-col overflow-y-auto border-l border-hairline-strong bg-surface-1/95 backdrop-blur">
      <button onClick={onClose} className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-md text-fg-faint hover:bg-interactive hover:text-fg">×</button>

      <header className="flex flex-col gap-2 px-5 pb-5 pt-5">
        <div className="flex items-center gap-2 text-[11px] text-fg-faint">
          <span>{node.origin}</span>
          {currentTier && <><span className="text-fg-deco">·</span><span>{currentTier.name ?? `tier ${currentTier.position}`}</span></>}
        </div>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNameDraft(display); setEditingName(false) } }}
            className="-mx-1 w-[calc(100%+0.5rem)] rounded-md bg-interactive px-1 py-0 text-[18px] font-medium text-fg ring-1 ring-inset ring-focus focus:outline-none"
          />
        ) : (
          <div
            onDoubleClick={() => { setNameDraft(display); setEditingName(true) }}
            className="cursor-text pr-7 text-[18px] font-medium leading-tight text-fg"
            title="double-click to rename"
          >{display}</div>
        )}
        {node.displayName && node.displayName !== node.name && (
          <div className="-mt-1 truncate font-mono text-[11px] text-fg-deco">{node.name}</div>
        )}
        {editingDesc ? (
          <textarea
            autoFocus
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => { if (e.key === 'Escape') { setDescDraft(node.description ?? ''); setEditingDesc(false) } }}
            className="min-h-[44px] w-full resize-y rounded-md bg-interactive px-2 py-1.5 text-[12.5px] text-fg ring-1 ring-inset ring-focus focus:outline-none"
          />
        ) : (
          <div
            onDoubleClick={() => { setDescDraft(node.description ?? ''); setEditingDesc(true) }}
            className="cursor-text text-[12.5px] leading-relaxed text-fg-muted"
            title="double-click to edit description"
          >{node.description || <span className="italic text-fg-deco">double-click to add description</span>}</div>
        )}
        <div className="mt-1 font-mono text-[11px] tabular-nums text-fg-faint">
          <span className="text-fg">{node.fileCount}</span> files
          <span className="mx-1.5 text-fg-deco">·</span>
          <span className="text-fg">{moduleCount}</span> {moduleCount === 1 ? 'module' : 'sub-modules'}
          <span className="mx-1.5 text-fg-deco">·</span>
          depth <span className="text-fg">{node.depth}</span>
        </div>
      </header>

      <div className="flex gap-1 border-b border-hairline px-5">
        <TabBtn active={tab === 'agent'} onClick={() => !agentDisabled && setTab('agent')} disabled={agentDisabled} title={agentDisabled ? 'no files in this module' : undefined}>Agent</TabBtn>
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabBtn>
      </div>

      {tab === 'overview' && (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-col gap-6 px-5 py-5">
            {node.children.length > 0 && <ContainsList node={node} />}
            <ConnectionsList node={node} edges={edges} allNodes={allNodes} />
          </div>
          <div className="mt-auto border-t border-hairline">
            <button
              onClick={() => setRestructureOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-left text-[13px] text-fg-muted transition hover:bg-interactive hover:text-fg"
            >
              <span>Restructure</span>
              <svg className={'h-3 w-3 text-fg-faint transition ' + (restructureOpen ? 'rotate-180' : '')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 4.5 6 7.5 9 4.5" />
              </svg>
            </button>
            {restructureOpen && (
              <RestructureDrawer
                node={node}
                tiers={sortedTiers}
                currentTier={currentTier}
                allNodes={allNodes}
                splitting={splitting}
                splittableItems={splittableItems}
                showSplit={showSplit}
                drawer={drawer}
                setDrawer={setDrawer}
                onMutate={onMutate}
                onClose={onClose}
                onSplit={onSplit}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'agent' && (
        <div className="flex flex-1 flex-col px-5 py-5">
          <AgentTab
            subject={display}
            subjectDetail={`${node.fileCount} files`}
            defaultRecipe="agent"
            state={agent}
            commands={commands}
            onSubmit={onAgentSubmit}
            onCancel={onCancelAgent}
            onClear={onClearAgent}
          />
        </div>
      )}
    </aside>
  )
}

function TabBtn({ active, disabled, onClick, title, children }: { active: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        '-mb-px border-b-2 px-1 py-2.5 text-[12.5px] transition',
        active ? 'border-fg text-fg' : 'border-transparent text-fg-faint hover:text-fg',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >{children}</button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-medium text-fg-dim">{children}</div>
}

function ContainsList({ node }: { node: ArchNode }) {
  return (
    <section>
      <SectionLabel>Contains</SectionLabel>
      <ul>
        {node.children.map((c, i) => (
          <li
            key={c.id}
            className={'flex items-baseline justify-between gap-3 py-1.5 ' + (i > 0 ? 'border-t border-hairline-subtle' : '')}
            title={c.description ?? c.name}
          >
            <span className="truncate text-[13px] text-fg">{c.displayName ?? c.name}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-faint">{c.fileCount}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConnectionsList({ node, edges, allNodes }: { node: ArchNode; edges: ModuleEdge[]; allNodes: ArchNode[] }) {
  const subtreeIds = subtree(node)
  const inbound = edges.filter((e) => subtreeIds.has(e.targetId) && !subtreeIds.has(e.sourceId))
  const outbound = edges.filter((e) => subtreeIds.has(e.sourceId) && !subtreeIds.has(e.targetId))
  const findName = (id: NodeId): string => {
    const n = findById(allNodes, id)
    return n ? (n.displayName ?? n.name) : `#${id}`
  }
  const groupBySource = new Map<NodeId, number>()
  for (const e of inbound) groupBySource.set(e.sourceId, (groupBySource.get(e.sourceId) ?? 0) + e.count)
  const groupByTarget = new Map<NodeId, number>()
  for (const e of outbound) groupByTarget.set(e.targetId, (groupByTarget.get(e.targetId) ?? 0) + e.count)
  const out = [...groupByTarget.entries()].map(([id, c]) => ({ label: findName(id), count: c })).sort((a, b) => b.count - a.count)
  const ins = [...groupBySource.entries()].map(([id, c]) => ({ label: findName(id), count: c })).sort((a, b) => b.count - a.count)
  return (
    <section>
      <SectionLabel>Connections</SectionLabel>
      <EdgeGroup arrow="↓" title="Imports" empty="no outbound" entries={out} />
      <EdgeGroup arrow="↑" title="Imported by" empty="no inbound" entries={ins} />
    </section>
  )
}

function EdgeGroup({ arrow, title, empty, entries }: { arrow: string; title: string; empty: string; entries: Array<{ label: string; count: number }> }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 flex items-baseline gap-2 text-[12px] text-fg-faint">
        <span className="font-mono text-fg-deco">{arrow}</span>
        <span>{title}</span>
        <span className="font-mono tabular-nums text-fg-deco">{entries.length || ''}</span>
      </div>
      {entries.length === 0 ? (
        <div className="pl-4 text-[11px] text-fg-deco">{empty}</div>
      ) : (
        <ul>
          {entries.slice(0, 12).map((it, i) => (
            <li key={i} className={'flex items-baseline justify-between gap-3 py-1 pl-4 ' + (i > 0 ? 'border-t border-hairline-subtle' : '')}>
              <span className="truncate text-[12.5px] text-fg-muted">{it.label}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-faint">{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RestructureDrawer({ node, tiers, currentTier, allNodes, splitting, splittableItems, showSplit, drawer, setDrawer, onMutate, onClose, onSplit }: {
  node: ArchNode
  tiers: Tier[]
  currentTier: Tier | null
  allNodes: ArchNode[]
  splitting: boolean
  splittableItems: number
  showSplit: boolean
  drawer: null | 'tier' | 'place' | 'split' | 'merge'
  setDrawer: (d: null | 'tier' | 'place' | 'split' | 'merge') => void
  onMutate: () => void
  onClose: () => void
  onSplit: (count: number | null, hint: string) => void
}) {
  const display = node.displayName ?? node.name
  const isTopLevel = node.parentId === null
  const otherModules = useMemo(() => {
    const flat: ArchNode[] = []
    const walk = (n: ArchNode) => { if (n.id !== node.id) flat.push(n); for (const c of n.children) walk(c) }
    for (const r of allNodes) walk(r)
    return flat
  }, [allNodes, node.id])
  const siblingCandidates = useMemo(() => otherModules.filter((n) => n.parentId === node.parentId), [otherModules, node.parentId])

  const moveTier = async (newTierId: number | null) => {
    try { await patchModuleRequest(node.id, { tierId: newTierId }); onMutate() } catch {}
    setDrawer(null)
  }
  const insertTierAndMove = async (position: number) => {
    try {
      const tier = await createTierRequest({ position })
      await patchModuleRequest(node.id, { tierId: tier.id })
      onMutate()
    } catch {}
    setDrawer(null)
  }
  const moveInto = async (targetId: number | null) => {
    try {
      await patchModuleRequest(node.id, { parentId: targetId, tierId: targetId === null ? node.tierId : null })
      onMutate()
    } catch {}
    setDrawer(null)
  }
  const onMerge = async (sourceIds: number[]) => {
    if (sourceIds.length === 0) return
    if (!confirm(`Merge ${sourceIds.length} module(s) into "${display}"? They will disappear and their contents move into this module.`)) return
    try {
      await mergeModulesRequest(node.id, sourceIds)
      onMutate()
    } catch {}
    setDrawer(null)
  }
  const onDelete = async () => {
    if (!confirm(`Delete "${display}"? Its ${node.children.length} children will be promoted to the parent level.`)) return
    try { await deleteModuleRequest(node.id); onMutate(); onClose() } catch {}
  }

  return (
    <div className="flex flex-col">
      {isTopLevel && (
        <Row label="Tier" value={currentTier?.name ?? (currentTier ? `pos ${currentTier.position}` : '—')} open={drawer === 'tier'} onToggle={() => setDrawer(drawer === 'tier' ? null : 'tier')}>
          <div className="flex flex-wrap gap-1.5">
            {tiers.map((t) => (
              <button
                key={t.id}
                onClick={() => moveTier(t.id)}
                className={[
                  'rounded px-2 py-1 text-[11.5px] transition',
                  t.id === node.tierId
                    ? 'bg-cta text-cta-fg'
                    : 'bg-interactive text-fg-muted hover:bg-interactive-active hover:text-fg',
                ].join(' ')}
              >{t.name ?? `pos ${t.position}`}</button>
            ))}
            <button
              onClick={() => insertTierAndMove((tiers[tiers.length - 1]?.position ?? -1) + 1)}
              className="rounded px-2 py-1 text-[11.5px] text-fg-faint hover:text-fg"
            >+ above all</button>
            {currentTier && (
              <button
                onClick={() => insertTierAndMove(currentTier.position + 1)}
                className="rounded px-2 py-1 text-[11.5px] text-fg-faint hover:text-fg"
              >+ above current</button>
            )}
            <button
              onClick={() => moveTier(null)}
              className="rounded px-2 py-1 text-[11.5px] text-fg-faint hover:text-accent-warn"
            >unset</button>
          </div>
        </Row>
      )}

      <Row label="Place in" value={isTopLevel ? 'top level' : 'nested'} open={drawer === 'place'} onToggle={() => setDrawer(drawer === 'place' ? null : 'place')}>
        {!isTopLevel && (
          <button
            onClick={() => moveInto(null)}
            className="mb-2 w-full rounded px-2 py-1.5 text-left text-[12px] text-fg-muted hover:bg-interactive hover:text-fg"
          >Promote to top level</button>
        )}
        <div className="max-h-[180px] overflow-y-auto">
          {otherModules.length === 0 ? (
            <div className="px-2 py-1 text-[12px] text-fg-deco">No other modules</div>
          ) : otherModules.map((m) => (
            <button
              key={m.id}
              onClick={() => void moveInto(m.id)}
              className="flex w-full items-baseline justify-between rounded px-2 py-1 text-left text-[12px] text-fg-muted hover:bg-interactive hover:text-fg"
            >
              <span className="truncate">{m.displayName ?? m.name}</span>
              <span className="shrink-0 font-mono tabular-nums text-fg-deco">{m.fileCount}</span>
            </button>
          ))}
        </div>
      </Row>

      {showSplit && (
        <Row label="Split with AI" value="" open={drawer === 'split'} onToggle={() => setDrawer(drawer === 'split' ? null : 'split')}>
          <SplitForm splittableItems={splittableItems} splitting={splitting} onSplit={onSplit} />
        </Row>
      )}

      {siblingCandidates.length > 0 && (
        <Row label="Merge into me" value={`${siblingCandidates.length} candidates`} open={drawer === 'merge'} onToggle={() => setDrawer(drawer === 'merge' ? null : 'merge')}>
          <MergeForm siblings={siblingCandidates} display={display} onMerge={onMerge} />
        </Row>
      )}

      <button
        onClick={onDelete}
        className="border-t border-hairline px-5 py-3 text-left text-[12.5px] text-accent-danger transition hover:bg-accent-danger/10 hover:text-accent-danger"
      >Delete this module</button>
    </div>
  )
}

function Row({ label, value, open, onToggle, children }: { label: string; value: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={'border-t border-hairline ' + (open ? 'bg-interactive' : '')}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition hover:bg-interactive">
        <span className="text-[12.5px] text-fg-muted">{label}</span>
        <span className="flex items-center gap-2 text-[11.5px] text-fg-faint">
          {value && <span className="truncate">{value}</span>}
          <svg className={'h-3 w-3 text-fg-deco transition ' + (open ? 'rotate-180' : '')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  )
}

function SplitForm({ splittableItems, splitting, onSplit }: { splittableItems: number; splitting: boolean; onSplit: (count: number | null, hint: string) => void }) {
  const [splitCountRaw, setSplitCountRaw] = useState<string>('2')
  const [splitHint, setSplitHint] = useState('')
  const splitCount = splitCountRaw.trim() === '' ? null : Math.max(2, Math.min(splittableItems, Math.floor(Number(splitCountRaw) || 0)))
  const hintNonEmpty = splitHint.trim().length > 0
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-fg-faint">Grouping hint (optional)</span>
        <textarea
          value={splitHint}
          onChange={(e) => setSplitHint(e.target.value)}
          placeholder="e.g. by feature; or split read vs write"
          className="min-h-[44px] resize-y rounded-md bg-interactive px-2 py-1.5 text-[12px] text-fg ring-1 ring-inset ring-hairline placeholder:text-fg-deco focus:outline-none focus:ring-focus"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-fg-faint">Into how many groups (max {splittableItems})</span>
        <input
          type="number"
          min={2}
          max={splittableItems}
          value={splitCountRaw}
          onChange={(e) => setSplitCountRaw(e.target.value)}
          className="rounded-md bg-interactive px-2 py-1.5 font-mono text-[12px] text-fg ring-1 ring-inset ring-hairline focus:outline-none focus:ring-focus"
        />
        {splitCount !== null && splitCount > 10 && (
          <span className="text-[11px] text-accent-warn">Heads up — more than ~10 groups gets hard to read</span>
        )}
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onSplit(splitCount, splitHint)}
          disabled={splitting || splitCount === null}
          className="flex-1 rounded-md bg-cta px-3 py-1.5 text-[12.5px] text-cta-fg transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-interactive-active disabled:text-fg-deco"
        >
          {splitting ? 'Asking…' : splitCount !== null ? `Split into ${splitCount}` : 'Split'}
        </button>
        <button
          onClick={() => onSplit(null, splitHint)}
          disabled={splitting || !hintNonEmpty}
          title={!hintNonEmpty ? 'Write a hint above to enable' : 'Let the model pick the count'}
          className="flex-1 rounded-md bg-interactive px-3 py-1.5 text-[12.5px] text-fg transition hover:bg-interactive-active hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Let AI decide
        </button>
      </div>
    </div>
  )
}

function MergeForm({ siblings, display, onMerge }: { siblings: ArchNode[]; display: string; onMerge: (ids: number[]) => void }) {
  const [picks, setPicks] = useState<Set<number>>(new Set())
  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[180px] overflow-y-auto rounded-md bg-interactive ring-1 ring-inset ring-hairline">
        {siblings.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-interactive">
            <input
              type="checkbox"
              checked={picks.has(m.id)}
              onChange={(e) => setPicks((prev) => { const n = new Set(prev); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })}
              className="accent-white"
            />
            <span className="flex-1 truncate text-[12px] text-fg-muted">{m.displayName ?? m.name}</span>
            <span className="font-mono text-[11px] tabular-nums text-fg-deco">{m.fileCount}</span>
          </label>
        ))}
      </div>
      <button
        onClick={() => { onMerge([...picks]); setPicks(new Set()) }}
        disabled={picks.size === 0}
        className="rounded-md bg-cta px-3 py-1.5 text-[12.5px] text-cta-fg transition hover:bg-cta-hover disabled:cursor-not-allowed disabled:bg-interactive-active disabled:text-fg-deco"
      >Merge {picks.size > 0 ? `${picks.size} into ${display}` : ''}</button>
    </div>
  )
}

function countModules(node: ArchNode): number {
  if (node.children.length === 0) return 1
  let n = 0
  for (const c of node.children) n += countModules(c)
  return n
}

function subtree(node: ArchNode): Set<NodeId> {
  const ids = new Set<NodeId>()
  const walk = (n: ArchNode) => { ids.add(n.id); for (const c of n.children) walk(c) }
  walk(node)
  return ids
}
