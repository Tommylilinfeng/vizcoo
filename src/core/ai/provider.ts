export interface CompleteOptions {
  model?: string
  signal?: AbortSignal
}

export interface AIProvider {
  readonly id: string
  complete(prompt: string, options?: CompleteOptions): Promise<string>
}
