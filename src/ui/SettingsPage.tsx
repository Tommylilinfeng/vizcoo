import { useEffect, useMemo, useState } from 'react'
import { Select, SegItem, type SelectOption } from './controls.js'
import { reanalyzeRequest } from './api.js'
import { readTermThemePref, writeTermThemePref, type TermThemePref } from './terminal/xterm-setup.js'

const TERM_THEME_OPTIONS: { value: TermThemePref; label: string; hint: string }[] = [
  { value: 'match', label: 'Match app', hint: 'follows theme toggle' },
  { value: 'dark', label: 'Dark', hint: 'always dark' },
  { value: 'light', label: 'Light', hint: 'macOS palette' },
]

interface ProjectInfo { root: string; port: number; pid: number; version: string }
interface HooksStatus { installed: boolean; port: number | null; portMatchesCurrent: boolean; settingsPath: string }
interface StorageInfo { projectsDir: string; sessionCount: number; totalBytes: number }
interface HooksPreview { port: number; hooks: Array<{ event: string; matcher?: string; command: string }> }
interface LauncherPrefs { model: string | null; skipPermissions: boolean; planMode: boolean }

const MODEL_OPTIONS: SelectOption<string | null>[] = [
  { value: null, label: 'Default', hint: "Claude's choice" },
  { value: 'opus', label: 'Opus 4.7', hint: 'Most capable' },
  { value: 'sonnet', label: 'Sonnet 4.6', hint: 'Balanced' },
  { value: 'haiku', label: 'Haiku 4.5', hint: 'Fastest' },
]

type Perm = 'default' | 'plan' | 'skip'
const PERM_OPTIONS: { value: Perm; label: string; hint: string }[] = [
  { value: 'default', label: 'Default', hint: 'Asks per tool call' },
  { value: 'plan', label: 'Plan', hint: '--permission-mode plan' },
  { value: 'skip', label: 'Skip', hint: '--dangerously-skip-permissions' },
]

const permFromBools = (skip: boolean, plan: boolean): Perm => skip ? 'skip' : plan ? 'plan' : 'default'

export interface SettingsPageProps {
  onDone: () => void
  onHooksChange?: () => void
}

export function SettingsPage({ onDone, onHooksChange }: SettingsPageProps) {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [hooks, setHooks] = useState<HooksStatus | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [preview, setPreview] = useState<HooksPreview | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [model, setModel] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Perm>('default')
  const [termTheme, setTermTheme] = useState<TermThemePref>(() => readTermThemePref())
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [refreshState, setRefreshState] = useState<'idle' | 'running' | 'done'>('idle')
  const [resetState, setResetState] = useState<'idle' | 'running' | 'done'>('idle')

  const refresh = async () => {
    try {
      const [p, h, s, pr] = await Promise.all([
        fetch('/api/project-info').then((r) => r.json() as Promise<ProjectInfo>),
        fetch('/api/hooks/status').then((r) => r.json() as Promise<HooksStatus>),
        fetch('/api/sessions/storage').then((r) => r.json() as Promise<StorageInfo>),
        fetch('/api/launcher/prefs').then((r) => r.json() as Promise<LauncherPrefs>),
      ])
      setProject(p); setHooks(h); setStorage(s)
      setModel(pr.model)
      setPermissions(permFromBools(pr.skipPermissions, pr.planMode))
      setPrefsLoaded(true)
    } catch (e) { setError((e as Error).message) }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  const skipPermissions = permissions === 'skip'
  const planMode = permissions === 'plan'

  useEffect(() => {
    if (!prefsLoaded) return
    void fetch('/api/launcher/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, skipPermissions, planMode }),
    })
  }, [prefsLoaded, model, skipPermissions, planMode])

  const onInstall = async () => {
    setBusy(true); setError(null)
    try { await fetch('/api/hooks/install', { method: 'POST' }); await refresh(); onHooksChange?.() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const onUninstall = async () => {
    setBusy(true); setError(null)
    try { await fetch('/api/hooks/uninstall', { method: 'POST' }); await refresh(); onHooksChange?.() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const togglePreview = async () => {
    if (!showPreview && !preview) {
      try { setPreview(await fetch('/api/hooks/preview').then((r) => r.json() as Promise<HooksPreview>)) }
      catch (e) { setError((e as Error).message); return }
    }
    setShowPreview(!showPreview)
  }
  const onCopyPath = async () => {
    if (!storage) return
    try { await navigator.clipboard.writeText(storage.projectsDir); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch (e) { setError((e as Error).message) }
  }

  const onRefreshModules = async () => {
    setRefreshState('running'); setError(null)
    try { await reanalyzeRequest(); setRefreshState('done'); setTimeout(() => setRefreshState('idle'), 2500) }
    catch (e) { setError((e as Error).message); setRefreshState('idle') }
  }

  const onResetAllModules = async () => {
    if (!confirm('This will discard all your renames, tier assignments, and module reorganization. The AI will rebuild module structure from scratch. Continue?')) return
    setResetState('running'); setError(null)
    try { await reanalyzeRequest({ reset: true }); setResetState('done'); setTimeout(() => setResetState('idle'), 2500) }
    catch (e) { setError((e as Error).message); setResetState('idle') }
  }

  const hooksOk = !!hooks && hooks.installed && hooks.portMatchesCurrent
  const activePerm = useMemo(() => PERM_OPTIONS.find((o) => o.value === permissions), [permissions])

  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface-0">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface-0/95 px-8 py-4 backdrop-blur">
        <h1 className="text-[15px] font-medium text-fg">Settings</h1>
        <button
          onClick={onDone}
          className="flex items-center gap-2 rounded-md bg-cta px-3 py-1.5 text-[12.5px] text-cta-fg transition hover:bg-cta-hover"
        >
          {hooksOk ? 'Done' : 'Skip for now'}
          <kbd className="grid h-[16px] min-w-[16px] place-items-center rounded border border-black/15 px-1 font-mono text-[10px] text-black/55">esc</kbd>
        </button>
      </header>

      {!hooksOk && (
        <div className="border-b border-accent-warn/20 bg-accent-warn/[0.08] px-8 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 text-[12.5px]">
            <span className="text-accent-warn">
              {hooks?.installed ? `Hooks installed for port ${hooks.port}, but vizcoo runs on ${project?.port}.` : 'Hooks not installed — vizcoo can\'t track Claude Code activity yet.'}
            </span>
            <button
              disabled={busy}
              onClick={onInstall}
              className="shrink-0 rounded-md bg-accent-warn-strong px-3 py-1 text-[12px] font-medium text-accent-warn-strong-fg transition hover:opacity-90 disabled:opacity-60"
            >
              {hooks?.installed ? 'Update' : 'Install'}
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-8 py-10">
        <Section title="Project">
          <Row label="Path" value={project?.root ?? '…'} mono />
          <Row label="Port" value={project ? String(project.port) : '…'} mono />
          <Row label="Process ID" value={project ? String(project.pid) : '…'} mono />
          <Row label="vizcoo" value={project?.version ?? '…'} mono />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={onRefreshModules}
              disabled={refreshState === 'running'}
              className="rounded-md bg-interactive px-3 py-1.5 text-[12px] text-fg-muted ring-1 ring-inset ring-hairline-strong transition hover:bg-interactive-active hover:text-fg disabled:opacity-60"
            >
              {refreshState === 'running' ? 'Refreshing…' : refreshState === 'done' ? 'Done' : 'Refresh modules'}
            </button>
            <span className="text-[11.5px] text-fg-faint">Re-detect modules from current files. Keeps your manual renames, splits, tier assignments.</span>
          </div>
        </Section>

        <Section title="Defaults for new sessions">
          <FieldRow label="Model">
            <Select<string | null> value={model} options={MODEL_OPTIONS} onChange={setModel} />
          </FieldRow>
          <FieldRow label="Permissions">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {PERM_OPTIONS.map((o) => (
                  <SegItem key={o.value} active={permissions === o.value} onClick={() => setPermissions(o.value)}>
                    {o.label}
                  </SegItem>
                ))}
              </div>
              <span className="ml-auto truncate font-mono text-[11px] text-fg-deco">{activePerm?.hint}</span>
            </div>
          </FieldRow>
        </Section>

        <Section title="Terminal">
          <FieldRow label="Theme">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {TERM_THEME_OPTIONS.map((o) => (
                  <SegItem
                    key={o.value}
                    active={termTheme === o.value}
                    onClick={() => { setTermTheme(o.value); writeTermThemePref(o.value) }}
                  >
                    {o.label}
                  </SegItem>
                ))}
              </div>
              <span className="ml-auto truncate font-mono text-[11px] text-fg-deco">
                {TERM_THEME_OPTIONS.find((o) => o.value === termTheme)?.hint}
              </span>
            </div>
          </FieldRow>
        </Section>

        <Section title="Hooks">
          <div className="text-[12.5px] leading-relaxed text-fg-dim">
            Capture what Claude Code does in this project — file edits, prompts, turn boundaries — for live tracking on the map and timeline.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Row label="Status" value={hooks ? (hooks.installed ? (hooks.portMatchesCurrent ? '✓ Installed' : `Port mismatch (${hooks.port})`) : 'Not installed') : '…'} />
          </div>
          <Row label="Settings file" value={hooks?.settingsPath ?? '…'} mono />
          <div className="mt-3 flex flex-wrap gap-2">
            {hooks && (!hooks.installed || !hooks.portMatchesCurrent) ? (
              <button disabled={busy} onClick={onInstall} className="rounded-md bg-cta px-3 py-1.5 text-[12px] font-medium text-cta-fg transition hover:bg-cta-hover disabled:opacity-60">
                {hooks.installed ? `Update for port ${project?.port}` : 'Install hooks'}
              </button>
            ) : hooks && (
              <button disabled={busy} onClick={onUninstall} className="rounded-md bg-interactive px-3 py-1.5 text-[12px] text-fg-muted ring-1 ring-inset ring-hairline-strong transition hover:bg-interactive-active hover:text-fg disabled:opacity-60">
                Uninstall
              </button>
            )}
            <button onClick={togglePreview} className="rounded-md px-3 py-1.5 text-[12px] text-fg-dim transition hover:bg-interactive hover:text-fg">
              {showPreview ? 'Hide config' : 'Show config'}
            </button>
          </div>
          {showPreview && preview && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-fg-dim ring-1 ring-inset ring-hairline">
{preview.hooks.map((h) => `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}\n  ${h.command}`).join('\n\n')}
            </pre>
          )}
        </Section>

        <Section title="Sessions">
          <Row label="Folder" value={storage?.projectsDir ?? '…'} mono />
          <Row label="Storage" value={storage ? `${storage.sessionCount} session${storage.sessionCount === 1 ? '' : 's'} · ${formatBytes(storage.totalBytes)}` : '…'} />
          <button onClick={onCopyPath} className="mt-2 self-start rounded-md px-3 py-1.5 text-[12px] text-fg-dim transition hover:bg-interactive hover:text-fg">
            {copied ? 'Copied!' : 'Copy path'}
          </button>
        </Section>

        <Section title="About">
          <Row label="Version" value={project?.version ?? '…'} />
          <Row label="License" value="Apache-2.0" />
        </Section>

        <section>
          <h2 className="mb-3 text-[15px] font-medium text-accent-danger">Danger zone</h2>
          <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/[0.08] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] text-fg">Reset all modules</div>
                <div className="mt-0.5 text-[11.5px] text-fg-faint">Discard manual renames, splits, tier assignments. AI rebuilds module structure from scratch.</div>
              </div>
              <button
                onClick={onResetAllModules}
                disabled={resetState === 'running'}
                className="shrink-0 rounded-md border border-accent-danger/40 bg-transparent px-3 py-1.5 text-[12px] text-accent-danger transition hover:bg-accent-danger/10 disabled:opacity-60"
              >
                {resetState === 'running' ? 'Resetting…' : resetState === 'done' ? 'Done' : 'Reset all modules'}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-md bg-accent-danger/10 px-3 py-2 text-[12px] text-accent-danger ring-1 ring-inset ring-accent-danger/30">{error}</div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-medium text-fg">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <span className="text-fg-faint">{label}</span>
      <span className={'min-w-0 truncate text-right text-fg ' + (mono ? 'font-mono text-[12px]' : '')} title={value}>{value}</span>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-2">
      <span className="text-[13px] text-fg-faint">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
