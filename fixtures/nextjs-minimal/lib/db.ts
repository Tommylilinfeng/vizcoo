export interface User {
  id: string
  name: string
}

export async function getUsers(): Promise<User[]> {
  return [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ]
}
