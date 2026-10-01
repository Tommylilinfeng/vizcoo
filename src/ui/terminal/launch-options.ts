export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORT_VALUES: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface LaunchOptions {
  model: string | null
  effort: Effort | null
  skipPermissions: boolean
  planMode: boolean
  resumeId: string | null
  initialPrompt?: string
}

export function buildPtyUrl(opts: LaunchOptions, size: { cols: number; rows: number }): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams()
  if (opts.resumeId) params.set('resume', opts.resumeId)
  if (opts.model) params.set('model', opts.model)
  if (opts.effort) params.set('effort', opts.effort)
  if (opts.skipPermissions) params.set('skipPerms', '1')
  if (opts.planMode) params.set('planMode', '1')
  params.set('cols', String(size.cols))
  params.set('rows', String(size.rows))
  return `${proto}://${location.host}/pty?${params.toString()}`
}
