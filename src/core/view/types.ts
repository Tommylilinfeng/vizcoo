export interface FileNode {
  path: string
  folder: string
  basename: string
}

export type FileChangeKind = 'edit' | 'write'

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  lineNumber: number | null
  text: string
}

export interface FileChange {
  path: string
  kind: FileChangeKind
  linesAdded: number
  linesRemoved: number
  oldString?: string
  newString?: string
  content?: string
  status?: 'pending' | 'done'      // live mode only
  contextStartLine?: number         // live mode only
  contextLines?: DiffLine[]         // live mode only (resolved against disk)
  toolUseId?: string                // live correlation
}

export interface Turn {
  index: number
  timestamp: number
  userText: string
  assistantText: string
  fileChanges: FileChange[]
}

export interface FilesResponse { files: FileNode[] }
export interface TurnsResponse { turns: Turn[] }
