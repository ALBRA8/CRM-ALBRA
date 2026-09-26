import { json } from '@/lib/api-helpers'

export async function GET() {
  return json({ ok: true, ts: new Date().toISOString() })
}
