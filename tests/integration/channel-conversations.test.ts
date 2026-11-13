import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { getOrCreateChannelConversation, resolveActiveChannelConnection } from '@/lib/channel-conversations'
import { FIX } from '../setup/seed-data'

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const connectionIds: string[] = []

afterEach(async () => {
  if (connectionIds.length) {
    await db.channelConversation.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
})

async function createInstagramConnection(key: string) {
  const id = `conversation-${suffix()}`
  connectionIds.push(id)
  return db.channelConnection.create({
    data: {
      id,
      organizationId: FIX.orgA.id,
      channel: 'instagram',
      provider: 'meta_graph',
      providerAccountKey: key,
      externalAccountId: key.split(':').pop()!,
      credentialsEnc: 'v1:test-ciphertext',
      status: 'connected',
    },
  })
}

describe('ChannelConversation — aislamiento por conexión', () => {
  it('crea conversaciones distintas para el mismo contacto en dos cuentas', async () => {
    const key = suffix()
    const first = await createInstagramConnection(`meta:instagram:${key}:one`)
    const second = await createInstagramConnection(`meta:instagram:${key}:two`)

    const a = await getOrCreateChannelConversation({
      providerAccountKey: first.providerAccountKey,
      channel: 'instagram',
      externalContactKey: 'same-contact',
    })
    const b = await getOrCreateChannelConversation({
      providerAccountKey: second.providerAccountKey,
      channel: 'instagram',
      externalContactKey: 'same-contact',
    })

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.id).not.toBe(b!.id)
    expect(a!.connectionId).toBe(first.id)
    expect(b!.connectionId).toBe(second.id)
  })

  it('no resuelve una cuenta si la clave o el canal no coinciden o está desconectada', async () => {
    const connection = await createInstagramConnection(`meta:instagram:${suffix()}`)
    expect(await resolveActiveChannelConnection('meta:instagram:unknown', 'instagram')).toBeNull()
    expect(await resolveActiveChannelConnection(connection.providerAccountKey, 'whatsapp')).toBeNull()

    await db.channelConnection.update({ where: { id: connection.id }, data: { status: 'disconnected' } })
    expect(await resolveActiveChannelConnection(connection.providerAccountKey, 'instagram')).toBeNull()
  })
})
