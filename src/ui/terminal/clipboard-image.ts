async function uploadBlob(blob: Blob): Promise<string> {
  const res = await fetch('/api/pty/paste-image', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  const json = (await res.json()) as { path: string }
  return json.path
}

export async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'))
      if (imgType) return await item.getType(imgType)
    }
  } catch { /* permission denied or no image */ }
  return null
}

export async function readClipboardText(): Promise<string> {
  if (!navigator.clipboard?.readText) return ''
  try { return await navigator.clipboard.readText() } catch { return '' }
}

export async function uploadImage(blob: Blob): Promise<string> {
  return await uploadBlob(blob)
}
