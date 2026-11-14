import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/whatsapp/webhook/route'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'

const APP_SECRET = ['whatsapp', 'test', 'secret'].join('-').repeat(2)
let organizationId: string | null = null
let channelConnectionId: string | null = null
let whatsappConnectionId: string | null = null

afterEach(async () => {
  if (channelConnectionId) {
    await db.channelWebhookEvent.deleteMany({ where: { connectionId: channelConnectionId } })
    await db.channelMessage.deleteMany({ where: { conversation: { is: { connectionId: channelConnectionId } } } })
    await db.channelConversation.deleteMany({ where: { connectionId: channelConnectionId } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: channelConnectionId } })
    await db.channelConnection.deleteMany({ where: { id: channelConnectionId } })
    channelConnectionId = null
  }
  if (whatsappConnectionId) {
    await db.whatsAppConnectionEvent.deleteMany({ where: { connectionId: whatsappConnectionId } })
    await db.whatsAppConnection.deleteMany({ where: { id: whatsappConnectionId } })
    whatsappConnectionId = null
  }
  if (organizationId) {
    await db.organization.deleteMany({ where: { id: organizationId } })
    organizationId = null
  }
})

function signedRequest(raw: string) {
  const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex')
  return new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
    method: 'POST',
    body: raw,
    headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
  })
}

describe('POST /api/whatsapp/webhook — stable event identity', () => {
  it('skips inbound messages without a stable provider ID before CRM/workflow side effects', async () => {
    const suffix = Date.now().toString()
    const phoneNumberId = `130000${suffix.slice(-8)}`
    const org = await db.organization.create({
      data: {
        id: `whatsapp-missing-id-${suffix}`,
        name: 'WhatsApp missing ID test',
        slug: `whatsapp-missing-id-${suffix}`,
      },
    })
    organizationId = org.id

    const waConnection = await db.whatsAppConnection.create({
      data: {
        organizationId: org.id,
        phoneNumberId,
        phoneNumber: '+573001234567',
        accessTokenEnc: encryptSecret('synthetic-access-token')!,
        metaAppSecretEnc: encryptSecret(APP_SECRET),
        webhookVerifyToken: `verify-${suffix}`,
        status: 'connected',
      },
    })
    whatsappConnectionId = waConnection.id

    const canonical = await db.channelConnection.create({
      data: {
        organizationId: org.id,
        channel: 'whatsapp',
        provider: 'meta_cloud',
        providerAccountKey: `meta:whatsapp:${phoneNumberId}`,
        externalAccountId: phoneNumberId,
        credentialsEnc: encryptSecret(JSON.stringify({ accessToken: 'synthetic-access-token' }))!,
        status: 'connected',
      },
    })
    channelConnectionId = canonical.id

    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'synthetic-waba',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: phoneNumberId },
            messages: [{
              from: '573009876543',
              type: 'text',
              text: { body: 'No debe crear efectos sin ID' },
            }],
          },
        }],
      }],
    })
    const response = await POST(signedRequest(raw))
    expect(response.status).toBe(200)
    expect(await db.channelWebhookEvent.count({ where: { connectionId: canonical.id } })).toBe(0)
    expect(await db.channelConversation.count({ where: { connectionId: canonical.id } })).toBe(0)
    expect(await db.timelineEvent.count({
      where: { organizationId: org.id, type: 'whatsapp', description: 'No debe crear efectos sin ID' },
    })).toBe(0)
  })
})
