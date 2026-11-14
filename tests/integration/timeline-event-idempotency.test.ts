import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { recordTimelineEvent } from '@/lib/timeline'
import { FIX } from '../setup/seed-data'

const keys: string[] = []

afterEach(async () => {
  if (keys.length) {
    await db.timelineEvent.deleteMany({ where: { sourceEventKey: { in: keys } } })
    keys.length = 0
  }
})

describe('timeline provider event idempotency', () => {
  it('does not duplicate an inbound event when a webhook retries in the same tenant', async () => {
    const key = `telegram:update:${Date.now()}:inbound`
    keys.push(key)
    const input = {
      orgId: FIX.orgA.id,
      type: 'telegram',
      source: 'integration',
      sourceEventKey: key,
      title: 'Synthetic Telegram inbound',
      description: 'Retry-safe fixture',
    }
    await recordTimelineEvent(input)
    await recordTimelineEvent(input)

    const rows = await db.timelineEvent.findMany({
      where: { organizationId: FIX.orgA.id, sourceEventKey: key },
    })
    expect(rows).toHaveLength(1)
  })

  it('scopes provider event keys by organization', async () => {
    const key = `provider:event:${Date.now()}:inbound`
    keys.push(key)
    await Promise.all([
      recordTimelineEvent({
        orgId: FIX.orgA.id, type: 'telegram', source: 'integration',
        sourceEventKey: key, title: 'Tenant A fixture',
      }),
      recordTimelineEvent({
        orgId: FIX.orgB.id, type: 'telegram', source: 'integration',
        sourceEventKey: key, title: 'Tenant B fixture',
      }),
    ])

    const rows = await db.timelineEvent.findMany({ where: { sourceEventKey: key } })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.organizationId))).toEqual(new Set([FIX.orgA.id, FIX.orgB.id]))
  })
})
