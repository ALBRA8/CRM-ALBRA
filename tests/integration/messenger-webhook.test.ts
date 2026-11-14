import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/facebook/webhook/route'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'

const APP_SECRET = 'messenger-test-secret'.repeat(2)
let organizationId: string | null = null
let connectionId: string | null = null

afterEach(async () => {
  if (connectionId) {
    await db.channelWebhookEvent.deleteMany({ where: { connectionId } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId } })
    await db.channelConnection.deleteMany({ where: { id: connectionId } })
    connectionId = null
  }
  if (organizationId) {
    await db.integration.deleteMany({ where: { organizationId } })
    await db.organization.deleteMany({ where: { id: organizationId } })
    organizationId = null
  }
})

function signedRequest(raw: string) {
  const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex')
  return new NextRequest('http://localhost:3000/api/facebook/webhook', {
    method: 'POST',
    body: raw,
    headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
  })
}

describe('POST /api/facebook/webhook — stable event identity', () => {
  it('skips inbound messages without a stable MID before CRM/workflow side effects', async () => {
    const suffix = Date.now().toString()
    const pageId = `120000${suffix.slice(-8)}`
    const org = await db.organization.create({
      data: {
        id: `messenger-missing-mid-${suffix}`,
        name: 'Messenger missing MID test',
        slug: `messenger-missing-mid-${suffix}`,
      },
    })
    organizationId = org.id
    await db.integration.create({
      data: {
        organizationId: org.id,
        facebookPageId: pageId,
        facebookTokenEnc: encryptSecret(JSON.stringify({ pageToken: 'synthetic-page-token', pageId }))!,
        metaAppSecretEnc: encryptSecret(APP_SECRET)!,
      },
    })

    const raw = JSON.stringify({
      object: 'page',
      entry: [{
        id: pageId,
        messaging: [{
          sender: { id: 'synthetic-contact-without-mid' },
          recipient: { id: pageId },
          message: { text: 'No debe crear efectos sin MID' },
        }],
      }],
    })
    const response = await POST(signedRequest(raw))
    expect(response.status).toBe(200)

    const connection = await db.channelConnection.findUnique({
      where: { providerAccountKey: `meta:messenger:${pageId}` },
      select: { id: true },
    })
    expect(connection).not.toBeNull()
    connectionId = connection!.id
    expect(await db.channelWebhookEvent.count({ where: { connectionId } })).toBe(0)
    expect(await db.timelineEvent.count({
      where: { organizationId: org.id, type: 'facebook', description: 'No debe crear efectos sin MID' },
    })).toBe(0)
  })
})
