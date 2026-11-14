import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { FIX } from '../setup/seed-data'

const createdIds: string[] = []
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

afterEach(async () => {
  if (createdIds.length) {
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: createdIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: createdIds } } })
    createdIds.length = 0
  }
})

async function createConnection(input: {
  organizationId: string
  channel: string
  providerAccountKey: string
  externalAccountId: string
}) {
  const id = `channel-${suffix()}`
  createdIds.push(id)
  return db.channelConnection.create({
    data: {
      id,
      organizationId: input.organizationId,
      channel: input.channel,
      provider: 'meta_cloud',
      providerAccountKey: input.providerAccountKey,
      externalAccountId: input.externalAccountId,
      credentialsEnc: 'v1:encrypted-test-fixture',
      status: 'connected',
    },
  })
}

describe('ChannelConnection — base multicuenta y aislamiento de datos', () => {
  it('permite dos cuentas del mismo canal en una organización', async () => {
    const key = suffix()
    const first = await createConnection({
      organizationId: FIX.orgA.id,
      channel: 'whatsapp',
      providerAccountKey: `meta:wa:${key}:one`,
      externalAccountId: `phone-${key}-one`,
    })
    const second = await createConnection({
      organizationId: FIX.orgA.id,
      channel: 'whatsapp',
      providerAccountKey: `meta:wa:${key}:two`,
      externalAccountId: `phone-${key}-two`,
    })

    const connections = await db.channelConnection.findMany({
      where: { organizationId: FIX.orgA.id, channel: 'whatsapp', id: { in: [first.id, second.id] } },
    })
    expect(connections).toHaveLength(2)
    expect(new Set(connections.map((connection) => connection.providerAccountKey)).size).toBe(2)
  })

  it('no permite reclamar la misma clave externa en dos workspaces', async () => {
    const key = `meta:instagram:${suffix()}`
    await createConnection({
      organizationId: FIX.orgA.id,
      channel: 'instagram',
      providerAccountKey: key,
      externalAccountId: 'ig-external-account',
    })

    await expect(createConnection({
      organizationId: FIX.orgB.id,
      channel: 'instagram',
      providerAccountKey: key,
      externalAccountId: 'ig-external-account',
    })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('el listado por organización no mezcla las conexiones de otro tenant', async () => {
    const key = suffix()
    const a = await createConnection({
      organizationId: FIX.orgA.id,
      channel: 'instagram',
      providerAccountKey: `meta:ig:${key}:a`,
      externalAccountId: `ig-a-${key}`,
    })
    const b = await createConnection({
      organizationId: FIX.orgB.id,
      channel: 'instagram',
      providerAccountKey: `meta:ig:${key}:b`,
      externalAccountId: `ig-b-${key}`,
    })

    const visibleToA = await db.channelConnection.findMany({ where: { organizationId: FIX.orgA.id } })
    expect(visibleToA.map((connection) => connection.id)).toContain(a.id)
    expect(visibleToA.map((connection) => connection.id)).not.toContain(b.id)
  })

  it('registra auditoría de conexión sin necesitar ni exponer credenciales', async () => {
    const connection = await createConnection({
      organizationId: FIX.orgA.id,
      channel: 'whatsapp',
      providerAccountKey: `meta:wa:event:${suffix()}`,
      externalAccountId: 'phone-event-fixture',
    })
    const event = await db.channelConnectionEvent.create({
      data: {
        organizationId: FIX.orgA.id,
        connectionId: connection.id,
        type: 'connected',
        detail: 'Conexión de prueba verificada',
      },
    })
    expect(event.connectionId).toBe(connection.id)
    expect(JSON.stringify(event)).not.toContain('encrypted-test-fixture')
  })
})
