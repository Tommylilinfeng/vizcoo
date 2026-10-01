import type Database from 'better-sqlite3'

export interface ModuleEditBody {
  displayName?: string | null
  description?: string | null
  tierId?: number | null
  parentId?: number | null
}

export function patchModuleEndpoint(
  db: Database.Database,
  moduleId: number,
  body: ModuleEditBody,
): { ok: true } {
  const target = db.prepare('SELECT id FROM modules WHERE id = ?').get(moduleId) as { id: number } | undefined
  if (!target) throw new Error(`module ${moduleId} not found`)
  const sets: string[] = []
  const params: unknown[] = []
  if ('displayName' in body) {
    sets.push('display_name = ?')
    params.push(body.displayName)
  }
  if ('description' in body) {
    sets.push('description = ?')
    params.push(body.description)
  }
  if ('tierId' in body) {
    if (body.tierId !== null) {
      const tierExists = db.prepare('SELECT id FROM tiers WHERE id = ?').get(body.tierId)
      if (!tierExists) throw new Error(`tier ${body.tierId} not found`)
    }
    sets.push('tier_id = ?')
    params.push(body.tierId)
  }
  if ('parentId' in body) {
    if (body.parentId !== null) {
      const parentExists = db.prepare('SELECT id FROM modules WHERE id = ?').get(body.parentId)
      if (!parentExists) throw new Error(`parent module ${body.parentId} not found`)
    }
    sets.push('parent_id = ?')
    params.push(body.parentId)
  }
  if (sets.length === 0) return { ok: true }
  sets.push('locked = 1')
  params.push(moduleId)
  db.prepare(`UPDATE modules SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return { ok: true }
}

export interface CreateModuleBody {
  displayName?: string | null
  description?: string | null
  tierId?: number | null
  parentId?: number | null
  origin?: string
}

export function createModuleEndpoint(db: Database.Database, body: CreateModuleBody): { id: number } {
  const display = (body.displayName ?? '').trim()
  if (!display) throw new Error('displayName required')
  if (body.parentId !== undefined && body.parentId !== null) {
    const parentExists = db.prepare('SELECT id FROM modules WHERE id = ?').get(body.parentId)
    if (!parentExists) throw new Error(`parent module ${body.parentId} not found`)
  }
  if (body.tierId !== undefined && body.tierId !== null) {
    const tierExists = db.prepare('SELECT id FROM tiers WHERE id = ?').get(body.tierId)
    if (!tierExists) throw new Error(`tier ${body.tierId} not found`)
  }
  const now = new Date().toISOString()
  const info = db.prepare(
    "INSERT INTO modules (parent_id, name, display_name, description, origin, created_at, tier_id, locked) " +
    "VALUES (?, ?, ?, ?, 'manual', ?, ?, 1)",
  ).run(
    body.parentId ?? null,
    display,
    display,
    body.description ?? null,
    now,
    body.tierId ?? null,
  )
  return { id: info.lastInsertRowid as number }
}

export interface MergeBody {
  sourceIds: number[]
  newDisplayName?: string
  newDescription?: string | null
}

export function mergeModulesEndpoint(db: Database.Database, targetId: number, body: MergeBody): { ok: true; absorbed: number } {
  const target = db.prepare('SELECT id FROM modules WHERE id = ?').get(targetId) as { id: number } | undefined
  if (!target) throw new Error(`target module ${targetId} not found`)
  if (!Array.isArray(body.sourceIds) || body.sourceIds.length === 0) throw new Error('sourceIds required')
  for (const sid of body.sourceIds) {
    if (sid === targetId) throw new Error('cannot merge a module into itself')
    const exists = db.prepare('SELECT id FROM modules WHERE id = ?').get(sid)
    if (!exists) throw new Error(`source module ${sid} not found`)
  }
  let absorbed = 0
  const tx = db.transaction(() => {
    const reparentChild = db.prepare('UPDATE modules SET parent_id = ? WHERE parent_id = ?')
    const reassignFile = db.prepare('UPDATE files SET module_id = ? WHERE module_id = ?')
    for (const sid of body.sourceIds) {
      reparentChild.run(targetId, sid)
      reassignFile.run(targetId, sid)
      db.prepare('DELETE FROM modules WHERE id = ?').run(sid)
      absorbed++
    }
    const sets: string[] = ['locked = 1']
    const params: unknown[] = []
    if (body.newDisplayName !== undefined && body.newDisplayName.trim().length > 0) {
      sets.push('display_name = ?')
      params.push(body.newDisplayName.trim())
    }
    if (body.newDescription !== undefined) {
      sets.push('description = ?')
      params.push(body.newDescription)
    }
    params.push(targetId)
    db.prepare(`UPDATE modules SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  })
  tx()
  return { ok: true, absorbed }
}

export function deleteModuleEndpoint(db: Database.Database, moduleId: number): { ok: true; promoted: number } {
  const target = db.prepare('SELECT id, parent_id FROM modules WHERE id = ?').get(moduleId) as { id: number; parent_id: number | null } | undefined
  if (!target) throw new Error(`module ${moduleId} not found`)
  let promoted = 0
  const tx = db.transaction(() => {
    const children = db.prepare('SELECT id FROM modules WHERE parent_id = ?').all(moduleId) as Array<{ id: number }>
    if (children.length > 0) {
      const reparent = db.prepare('UPDATE modules SET parent_id = ? WHERE id = ?')
      for (const c of children) {
        reparent.run(target.parent_id, c.id)
        promoted++
      }
    }
    db.prepare('UPDATE files SET module_id = ? WHERE module_id = ?').run(target.parent_id, moduleId)
    db.prepare('DELETE FROM modules WHERE id = ?').run(moduleId)
  })
  tx()
  return { ok: true, promoted }
}
