import * as path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type Database from 'better-sqlite3'
import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'
import { processFile, deleteFile } from '../index-project.js'

const ALWAYS_IGNORED = ['node_modules', '.git', '.vizcoo', '.ctx']

export interface WatchHandlers {
  onChange: () => void
}

export function watchProject(
  root: string,
  db: Database.Database,
  analyzers: LanguageAnalyzer[],
  handlers: WatchHandlers,
): FSWatcher {
  const ignoreNames = new Set([...ALWAYS_IGNORED, ...analyzers.flatMap((a) => a.ignorePatterns)])
  const ignoreRe = new RegExp(`(^|[/\\\\])(${[...ignoreNames].map(reEscape).join('|')})([/\\\\]|$)`)
  const watcher = chokidar.watch(root, {
    ignored: (p) => ignoreRe.test(p),
    ignoreInitial: true,
    persistent: true,
  })

  const onFile = (absPath: string): void => {
    const relPath = toRel(root, absPath)
    if (!analyzers.some((a) => a.canHandle(relPath))) return
    void processFile(db, root, relPath, analyzers).then(() => handlers.onChange())
  }

  const onUnlink = (absPath: string): void => {
    const relPath = toRel(root, absPath)
    if (!analyzers.some((a) => a.canHandle(relPath))) return
    deleteFile(db, relPath)
    handlers.onChange()
  }

  watcher.on('add', onFile)
  watcher.on('change', onFile)
  watcher.on('unlink', onUnlink)
  return watcher
}

function toRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/')
}

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
