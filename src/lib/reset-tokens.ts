// Simple in-memory reset token store
// In production, use a database table or Redis with TTL

interface ResetTokenEntry {
  token: string
  expiresAt: number
}

const resetTokens = new Map<string, ResetTokenEntry[]>()

export function storeResetToken(userId: string, token: string, ttlMs: number) {
  const entry: ResetTokenEntry = { token, expiresAt: Date.now() + ttlMs }

  const existing = resetTokens.get(userId) || []
  // Clean expired tokens
  const valid = existing.filter(e => e.expiresAt > Date.now())
  valid.push(entry)
  resetTokens.set(userId, valid)
}

export function validateResetToken(userId: string, token: string): boolean {
  const entries = resetTokens.get(userId)
  if (!entries) return false

  const now = Date.now()
  const validEntry = entries.find(e => e.token === token && e.expiresAt > now)
  return !!validEntry
}

export function consumeResetToken(userId: string, token: string): void {
  const entries = resetTokens.get(userId)
  if (!entries) return

  const filtered = entries.filter(e => e.token !== token)
  if (filtered.length === 0) {
    resetTokens.delete(userId)
  } else {
    resetTokens.set(userId, filtered)
  }
}
