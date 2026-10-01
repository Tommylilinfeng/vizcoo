export interface DetectorContext {
  root: string
  packageJson: unknown
  fileList: string[]
}

export interface DetectorResult {
  modules: Array<{
    name: string
    files: string[]
    keyExports?: string[]
    dirs?: string[]
  }>
  confidence: number
}

export interface FrameworkDetector {
  readonly id: string
  detect(ctx: DetectorContext): DetectorResult | null
}
