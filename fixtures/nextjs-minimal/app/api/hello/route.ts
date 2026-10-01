import { getUsers } from '../../../lib/db.js'

export async function GET() {
  const users = await getUsers()
  return Response.json({ users })
}
