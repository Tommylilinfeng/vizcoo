import * as fs from 'node:fs'
import type { Turn, FileChange } from './types.js'

export function parseTurns(filePath: string): Turn[] {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  const records = lines.map((l) => safeParse(l)).filter(isRecord)
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const d of records) {
    if (d.type === 'user' && isUserText(d)) {
      const text = extractUserText(d) ?? ''
      if (text.startsWith('<system-reminder>') || text.startsWith('Caveat:')) continue
      if (current) turns.push(current)
      current = {
        index: turns.length,
        timestamp: parseTs(d.timestamp),
        userText: text,
        assistantText: '',
        fileChanges: [],
      }
      continue
    }
    if (!current) continue
    if (d.type === 'assistant') {
      const content = getMessageContent(d)
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === 'text' && typeof block.text === 'string') {
          current.assistantText += (current.assistantText ? '\n' : '') + block.text
        }
        if (block.type === 'tool_use') {
          const ch = changeFromToolUse(block)
          if (ch) current.fileChanges.push(ch)
        }
      }
    }
  }
  if (current) turns.push(current)
  return turns
}

function isUserText(d: Record<string, unknown>): boolean {
  const content = getMessageContent(d)
  if (content.length === 0) return typeof getMessageStringContent(d) === 'string'
  return content.some((c) => isRecord(c) && c.type === 'text')
}

function extractUserText(d: Record<string, unknown>): string | null {
  const stringContent = getMessageStringContent(d)
  if (typeof stringContent === 'string') return stringContent
  const content = getMessageContent(d)
  for (const c of content) {
    if (isRecord(c) && c.type === 'text' && typeof c.text === 'string') return c.text
  }
  return null
}

function getMessageContent(d: Record<string, unknown>): unknown[] {
  const msg = isRecord(d.message) ? d.message : null
  if (!msg) return []
  return Array.isArray(msg.content) ? msg.content : []
}

function getMessageStringContent(d: Record<string, unknown>): unknown {
  const msg = isRecord(d.message) ? d.message : null
  if (!msg) return undefined
  return typeof msg.content === 'string' ? msg.content : undefined
}

function changeFromToolUse(block: Record<string, unknown>): FileChange | null {
  const name = typeof block.name === 'string' ? block.name : ''
  const input = isRecord(block.input) ? block.input : null
  if (!input) return null
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  if (!filePath) return null
  if (name === 'Write') {
    const content = typeof input.content === 'string' ? input.content : ''
    return { path: filePath, kind: 'write', linesAdded: lineCount(content), linesRemoved: 0, content }
  }
  if (name === 'Edit') {
    const oldS = typeof input.old_string === 'string' ? input.old_string : ''
    const newS = typeof input.new_string === 'string' ? input.new_string : ''
    return { path: filePath, kind: 'edit', linesAdded: lineCount(newS), linesRemoved: lineCount(oldS), oldString: oldS, newString: newS }
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0, removed = 0
    const oldParts: string[] = []
    const newParts: string[] = []
    for (const e of input.edits) {
      if (!isRecord(e)) continue
      const o = typeof e.old_string === 'string' ? e.old_string : ''
      const n = typeof e.new_string === 'string' ? e.new_string : ''
      removed += lineCount(o)
      added += lineCount(n)
      if (o) oldParts.push(o)
      if (n) newParts.push(n)
    }
    return { path: filePath, kind: 'edit', linesAdded: added, linesRemoved: removed, oldString: oldParts.join('\n\n'), newString: newParts.join('\n\n') }
  }
  return null
}

function lineCount(s: string): number {
  if (!s) return 0
  return s.split('\n').length
}

function parseTs(v: unknown): number {
  if (typeof v !== 'string') return 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

function safeParse(line: string): unknown {
  try { return JSON.parse(line) } catch { return null }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
