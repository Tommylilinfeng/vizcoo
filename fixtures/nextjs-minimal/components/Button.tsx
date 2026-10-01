export function Button({ label }: { label: string }) {
  async function onClick() {
    await fetch('/api/hello')
  }
  return <button onClick={onClick}>{label}</button>
}
