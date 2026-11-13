/**
 * Servicios de conversación multicuenta.
 *
 * La resolución se hace por providerAccountKey exacta (namespace + ID externo),
 * nunca por organizationId recibido en el webhook ni por "primera conexión".
 * Las conversaciones nuevas se particionan por connectionId + contacto.
 */
import { db } from '@/lib/db'

export async function resolveActiveChannelConnection(
  providerAccountKey: string,
  channel: string,
) {
  if (!providerAccountKey || !channel) return null

  const connection = await db.channelConnection.findUnique({
    where: { providerAccountKey },
  })
  if (
    !connection ||
    connection.channel !== channel ||
    connection.status !== 'connected'
  ) {
    return null
  }
  return connection
}

export async function getOrCreateChannelConversation(input: {
  providerAccountKey: string
  channel: string
  externalContactKey: string
  contactName?: string | null
}) {
  const externalContactKey = input.externalContactKey.trim()
  if (!externalContactKey) throw new Error('externalContactKey requerido')

  const connection = await resolveActiveChannelConnection(
    input.providerAccountKey,
    input.channel,
  )
  if (!connection) return null

  return db.channelConversation.upsert({
    where: {
      connectionId_externalContactKey: {
        connectionId: connection.id,
        externalContactKey,
      },
    },
    create: {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      channel: connection.channel,
      externalContactKey,
      contactName: input.contactName ?? null,
    },
    update: {
      ...(input.contactName ? { contactName: input.contactName } : {}),
    },
  })
}
