import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawRustImport } from './parse-rust.js'

export interface RustConfig {
  crateRoots: Array<{ name: string; root: string }>   // crate name → src/lib.rs or src/main.rs
}

export function readRustConfig(root: string): RustConfig {
  const crateRoots: RustConfig['crateRoots'] = []
  const cargoToml = path.join(root, 'Cargo.toml')
  let crateName = 'crate'
  if (fs.existsSync(cargoToml)) {
    const text = fs.readFileSync(cargoToml, 'utf8')
    const m = text.match(/^\s*name\s*=\s*"([^"]+)"/m)
    if (m && m[1]) crateName = m[1].replace(/-/g, '_')
  }
  const libRs = path.join(root, 'src', 'lib.rs')
  const mainRs = path.join(root, 'src', 'main.rs')
  if (fs.existsSync(libRs)) crateRoots.push({ name: crateName, root: 'src/lib.rs' })
  if (fs.existsSync(mainRs)) crateRoots.push({ name: crateName, root: 'src/main.rs' })
  return { crateRoots }
}

export function resolveRust(
  imp: RawRustImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: RustConfig,
): string[] {
  const segments = imp.path.split('::').filter((s) => s.length > 0)
  if (segments.length === 0) return []

  if (imp.kind === 'mod') {
    return resolveMod(segments[0]!, fromFile, root, knownFiles)
  }

  const head = segments[0]!
  if (head === 'crate' || head === 'self' || head === 'super') {
    return resolveModPath(segments, fromFile, root, knownFiles, config)
  }
  for (const cr of config.crateRoots) {
    if (head === cr.name) return resolveModPath(['crate', ...segments.slice(1)], fromFile, root, knownFiles, config)
  }
  return []
}

function resolveMod(name: string, fromFile: string, root: string, knownFiles: Set<string>): string[] {
  const fromDir = path.dirname(path.join(root, fromFile))
  const fromBase = path.basename(fromFile, '.rs')
  const candidateBase = (fromBase === 'mod' || fromBase === 'lib' || fromBase === 'main')
    ? fromDir
    : path.join(fromDir, fromBase)
  const cands = [
    path.join(candidateBase, name + '.rs'),
    path.join(candidateBase, name, 'mod.rs'),
  ]
  return cands.map((c) => relIfKnown(c, root, knownFiles)).filter((x): x is string => !!x)
}

function resolveModPath(segments: string[], fromFile: string, root: string, knownFiles: Set<string>, config: RustConfig): string[] {
  let dir = path.join(root, 'src')
  let i = 0
  if (segments[0] === 'crate') {
    i = 1
  } else if (segments[0] === 'self') {
    dir = currentModDir(fromFile, root)
    i = 1
  } else if (segments[0] === 'super') {
    let baseDir = currentModDir(fromFile, root)
    while (i < segments.length && segments[i] === 'super') {
      baseDir = path.dirname(baseDir)
      i++
    }
    dir = baseDir
  } else {
    if (config.crateRoots.length > 0) i = 1
  }

  for (; i < segments.length; i++) {
    const seg = segments[i]!
    const fileCand = path.join(dir, seg + '.rs')
    const dirModCand = path.join(dir, seg, 'mod.rs')
    if (fs.existsSync(fileCand)) {
      return relIfArr(fileCand, root, knownFiles)
    } else if (fs.existsSync(dirModCand)) {
      if (i === segments.length - 1) return relIfArr(dirModCand, root, knownFiles)
      dir = path.join(dir, seg)
      continue
    } else {
      if (i === 0) return []
      const modRs = path.join(dir, 'mod.rs')
      const libRs = path.join(dir, 'lib.rs')
      if (fs.existsSync(modRs)) return relIfArr(modRs, root, knownFiles)
      if (fs.existsSync(libRs)) return relIfArr(libRs, root, knownFiles)
      return []
    }
  }
  const modRs = path.join(dir, 'mod.rs')
  if (fs.existsSync(modRs)) return relIfArr(modRs, root, knownFiles)
  return []
}

function currentModDir(fromFile: string, root: string): string {
  const abs = path.join(root, fromFile)
  const base = path.basename(abs, '.rs')
  if (base === 'mod' || base === 'lib' || base === 'main') return path.dirname(abs)
  return path.join(path.dirname(abs), base)
}

function isLeafLike(seg: string): boolean {
  if (seg === '*') return true
  return /^[A-Z_][A-Z0-9_]*$/.test(seg) || /^[A-Z]/.test(seg)
}

function relIfKnown(absPath: string, root: string, knownFiles: Set<string>): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const posix = rel.split(path.sep).join('/')
  return knownFiles.has(posix) ? posix : null
}

function relIfArr(absPath: string, root: string, knownFiles: Set<string>): string[] {
  const r = relIfKnown(absPath, root, knownFiles)
  return r ? [r] : []
}
