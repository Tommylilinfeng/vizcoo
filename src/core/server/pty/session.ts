import * as pty from 'node-pty'

export interface SpawnOptions {
  command: string
  args?: string[]
  cwd: string
  cols: number
  rows: number
  env?: NodeJS.ProcessEnv
}

export interface Session {
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(handler: (data: string) => void): void
  onExit(handler: (code: number) => void): void
  dispose(): void
}

export function spawn(opts: SpawnOptions): Session {
  const proc = pty.spawn(opts.command, opts.args ?? [], {
    name: 'xterm-256color',
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env: opts.env ?? process.env,
  })
  return {
    write(data) { proc.write(data) },
    resize(cols, rows) { proc.resize(cols, rows) },
    onData(handler) { proc.onData(handler) },
    onExit(handler) { proc.onExit(({ exitCode }) => handler(exitCode)) },
    dispose() { proc.kill() },
  }
}
