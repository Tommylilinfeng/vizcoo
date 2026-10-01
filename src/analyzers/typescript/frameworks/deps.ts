export function readDeps(packageJson: unknown): Set<string> {
  if (packageJson === null || typeof packageJson !== 'object') return new Set()
  const pkg = packageJson as { dependencies?: unknown; devDependencies?: unknown; peerDependencies?: unknown }
  const out = new Set<string>()
  for (const field of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (field && typeof field === 'object') {
      for (const k of Object.keys(field)) out.add(k)
    }
  }
  return out
}
