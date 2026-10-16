import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { sendWhatsAppCloud } from '@/lib/integrations'

const MAX_ATTEMPTS = 8
const LEASE_MS = 2 * 60 * 1000

/**
 * Attempts one durable delivery. If the process dies or the provider is
 * temporarily unavailable, the row remains eligible for the retry worker.
 * Cloud API does not provide a universal idempotency key for send-message,
 * so a timeout after provider acceptance can still cause a duplicate on retry.
 */
export async function dispatchWhatsAppOutboxDelivery(
  id: string,
  override?: { token: string; phoneId: string },
): Promise<'sent' | 'retry' | 'dead' | 'busy'> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - LEASE_MS)
  const claimed = await db.whatsAppOutboundDelivery.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['pending', 'retry'] }, nextAttemptAt: { lte: now } },
        { status: 'sending', lockedAt: { lt: staleBefore } },
      ],
    },
    data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
  })
  if (claimed.count !== 1) return 'busy'

  const delivery = await db.whatsAppOutboundDelivery.findUnique({ where: { id } })
  if (!delivery) return 'dead'
  const integration = override ? null : await db.integration.findUnique({
    where: { organizationId: delivery.organizationId },
    select: { whatsappCloudTokenEnc: true, whatsappPhoneId: true },
  })
  const token = override?.token || decryptSecret(integration?.whatsappCloudTokenEnc)
  const phoneId = override?.phoneId || integration?.whatsappPhoneId
  if (!token || !phoneId) {
    const dead = delivery.attempts >= MAX_ATTEMPTS
    await db.whatsAppOutboundDelivery.update({
      where: { id },
      data: {
        status: dead ? 'dead' : 'retry',
        lastError: 'credentials_unavailable',
        lockedAt: null,
        nextAttemptAt: new Date(Date.now() + Math.min(30_000 * (2 ** Math.max(0, delivery.attempts - 1)), 3_600_000)),
      },
    })
    return dead ? 'dead' : 'retry'
  }

  const result = await sendWhatsAppCloud({
    token,
    phoneId,
    to: delivery.recipient,
    text: delivery.text,
  })
  if (result.ok) {
    await db.whatsAppOutboundDelivery.update({
      where: { id },
      data: { status: 'sent', providerMessageId: result.id || null, lastError: null, lockedAt: null },
    })
    return 'sent'
  }

  const dead = delivery.attempts >= MAX_ATTEMPTS
  await db.whatsAppOutboundDelivery.update({
    where: { id },
    data: {
      status: dead ? 'dead' : 'retry',
      // Store a category, not provider payloads or credentials.
      lastError: 'provider_send_failed',
      lockedAt: null,
      nextAttemptAt: new Date(Date.now() + Math.min(30_000 * (2 ** Math.max(0, delivery.attempts - 1)), 3_600_000)),
    },
  })
  return dead ? 'dead' : 'retry'
}

export async function dispatchWhatsAppOutboxBatch(limit = 10): Promise<{ sent: number; retry: number; dead: number }> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - LEASE_MS)
  const rows = await db.whatsAppOutboundDelivery.findMany({
    where: {
      OR: [
        { status: { in: ['pending', 'retry'] }, nextAttemptAt: { lte: now } },
        { status: 'sending', lockedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 50)),
    select: { id: true },
  })
  const counts = { sent: 0, retry: 0, dead: 0 }
  for (const row of rows) {
    const result = await dispatchWhatsAppOutboxDelivery(row.id)
    if (result === 'sent' || result === 'retry' || result === 'dead') counts[result]++
  }
  return counts
}
