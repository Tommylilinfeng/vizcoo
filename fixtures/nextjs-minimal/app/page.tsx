import { Button } from '../components/Button.js'
import { getUsers } from '../lib/db.js'

export default async function Home() {
  const users = await getUsers()
  return (
    <main>
      <h1>Users</h1>
      <ul>
        {users.map((u) => (
          <li key={u.id}>{u.name}</li>
        ))}
      </ul>
      <Button label="Refresh" />
    </main>
  )
}
