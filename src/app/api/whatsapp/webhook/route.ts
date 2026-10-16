import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { decryptSecret } from '@/lib/crypto'
import {
  verifyMetaSignature,
  normalizePhone,
  findOrCreateChannelClient,
  buildNichoContext,
  getHandoffKeywords,
  sendWhatsAppCloud,
} from '@/lib/integrations'
import { llmReplyOrNotification } from '@/lib/channel-agent'
import { transcribeAudioBase64 } from '@/lib/asr'
import { analyzeImageBase64 } from '@/lib/ai'
import sharp from 'sharp'
import { notifyOrganization } from '@/lib/push'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 * GET  — verificación de suscripción de Meta: hub.verify_token debe coincidir con el
 *        App Secret configurado (o con WHATSAPP_VERIFY_TOKEN global) → devuelve hub.challenge.
 * POST — validación ESTRICTA de X-Hub-Signature-256 (HMAC-SHA256 del body crudo con el
 *        App Secret cifrado por organización). CIERRA el fallo de auditoría (webhooks sin firma).
 *
 * Procesa mensajes entrantes: find-or-create Client por teléfono, timeline whatsapp,
 * trigger message_received, auto-respuesta IA (NichoConfig) enviada por Cloud API si hay
 * token configurado; si no, la respuesta queda registrada en el timeline.
 */

interface WaValue {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: Array<{
    from: string
    id: string
    timestamp?: string
    text?: { body?: string }
    type?: string
    audio?: { id: string; mime_type?: string }
    image?: { id: string; mime_type?: string; caption?: string }
    button?: { text?: string }
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  }>
  statuses?: Array<{ id: string; status: string }>
}

interface WaWebhookBody {
  object?: string
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WaValue }> }>
}

/** Verificación GET (Meta exige text/plain con el challenge) */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!mode || !token || !challenge) {
    return NextResponse.json({ error: 'Faltan parámetros de verificación (hub.mode, hub.verify_token, hub.challenge)' }, { status: 400 })
  }
  if (mode !== 'subscribe') return new Response('Forbidden', { status: 403 })

  const globalToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (globalToken && token === globalToken) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  // Meta separa verify_token (secreto elegido por el operador) de App Secret
  // (usado para validar X-Hub-Signature-256 en POST). Nunca intercambiar ambos.
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let activeEventId: string | null = null
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    let body: WaWebhookBody
    try {
      body = JSON.parse(rawBody) as WaWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Localiza la org validando la firma contra cada app secret configurado.
    // OPTIMIZACIÓN (auditoría Antigravity, importante #4): si el webhook trae
    // phone_number_id, pre-filtramos por él ANTES del bucle criptográfico —
    // típicamente 1 candidato en vez de desencriptar + HMAC para TODAS las orgs.
    const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null
    const candidates = await db.integration.findMany({
      where: {
        metaAppSecretEnc: { not: null },
        ...(phoneNumberId ? { whatsappPhoneId: phoneNumberId } : {}),
      },
      select: { organizationId: true, metaAppSecretEnc: true, whatsappPhoneId: true, whatsappCloudTokenEnc: true },
    })
    let matchedOrgId: string | null = null
    let matchedValue: WaValue | null = null
    let matchedCloudToken: string | null = null
    let matchedPhoneId: string | null = null

    for (const candidate of candidates) {
      const secret = decryptSecret(candidate.metaAppSecretEnc)
      if (!secret) continue
      if (!verifyMetaSignature(rawBody, secret, signature)) continue
      for (const change of (body.entry || []).flatMap((e) => e.changes || [])) {
        const value = change.value
        if (!value) continue
        // Aislamiento multi-tenant: el phone_number_id debe ser el de esta org (si está definido)
        if (candidate.whatsappPhoneId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== candidate.whatsappPhoneId) continue
        matchedOrgId = candidate.organizationId
        matchedValue = value
        matchedCloudToken = decryptSecret(candidate.whatsappCloudTokenEnc)
        matchedPhoneId = candidate.whatsappPhoneId
        break
      }
      if (matchedOrgId) break
    }

    if (!matchedOrgId) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    const value = matchedValue as WaValue

    // Estados de entrega (sent/delivered/read) — solo timeline si hay clientId conocido
    for (const status of value.statuses || []) {
      await recordTimelineEvent({
        orgId: matchedOrgId,
        type: 'whatsapp',
        title: `Estado del mensaje: ${status.status}`,
        metadata: { messageId: status.id, status: status.status, direction: 'out' },
        source: 'integration',
      })
    }

    for (const message of value.messages || []) {
      // Idempotencia durable: un ID único por org/proveedor, con lease para
      // recuperar eventos fallidos o abandonados tras un reinicio del proceso.
      if (message.id) {
        const claim = await claimWhatsAppWebhookEvent(matchedOrgId, message.id)
        if (!claim.claimed) continue
        activeEventId = claim.id
      }
      let text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
      let isVoice = false
      let isImage = false
      let imageAnalyzed = false

      // Notas de voz (Cloud API type 'audio'): antes se descartaban ("if (!text) continue").
      // Se descargan del Graph API con el token Cloud de la org y se transcriben (ASR).
      if (!text && message.audio) {
        try {
          if (!matchedCloudToken) throw new Error('No hay token de WhatsApp Cloud para descargar el audio')
          const buf = await downloadWaCloudMedia({ token: matchedCloudToken, mediaId: message.audio.id })
          text = await transcribeAudioBase64(buf.toString('base64'), matchedOrgId, message.audio.mime_type || 'audio/ogg')
          isVoice = true
        } catch (err) {
          // Fail-open a humano: la nota queda registrada en timeline + push al equipo
          console.error('[whatsapp webhook] nota de voz no transcrita', err)
          const phoneFall = normalizePhone(message.from)
          if (phoneFall) {
            const fbClient = await findOrCreateChannelClient({ orgId: matchedOrgId, platformKey: phoneFall, name: null, source: 'whatsapp' })
            await recordTimelineEvent({
              orgId: matchedOrgId,
              clientId: fbClient?.id || null,
              type: 'whatsapp',
              title: `Nota de voz recibida de ${phoneFall} (no transcrita)`,
              description: 'No se pudo transcribir la nota de voz automáticamente. Escucha el audio desde WhatsApp.',
              metadata: { from: phoneFall, direction: 'in', voice: true, messageId: message.id, reason: err instanceof Error ? err.message : 'desconocido' },
              source: 'integration',
            })
            await notifyOrganization(matchedOrgId, {
              type: 'integration',
              title: 'WhatsApp: nota de voz sin transcribir',
              body: `${phoneFall} envió una nota de voz que no se pudo transcribir. Escucha el audio en WhatsApp.`,
              data: JSON.stringify({ clientId: fbClient?.id, channel: 'whatsapp' }),
            })
          }
        }
      }
      if (!text && message.image) {
        isImage = true
        try {
          if (!matchedCloudToken) throw new Error('No hay token de WhatsApp Cloud para descargar la imagen')
          const mime = (message.image.mime_type || '').split(';')[0].toLowerCase()
          if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
            throw new Error('Formato de imagen no soportado')
          }
          const buf = await downloadWaCloudMedia({ token: matchedCloudToken, mediaId: message.image.id, maxBytes: 8 * 1024 * 1024 })
          if (!await isValidCloudImage(buf, mime)) throw new Error('Imagen corrupta, formato inválido o dimensiones excesivas')
          const description = await analyzeImageBase64(matchedOrgId, buf.toString('base64'), mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif')
          text = `Descripción de la imagen enviada por el cliente: ${description}${message.image.caption ? `\nTexto adjunto: ${message.image.caption.slice(0, 1000)}` : ''}`
          imageAnalyzed = true
        } catch (err) {
          console.error('[whatsapp webhook] imagen no analizada', err instanceof Error ? err.message : 'unknown error')
          text = 'Imagen recibida (no se pudo analizar automáticamente; requiere revisión humana).'
          await notifyOrganization(matchedOrgId, {
            type: 'integration',
            title: 'WhatsApp: imagen requiere revisión',
            body: 'Se recibió una imagen que no pudo analizarse automáticamente. Revisa el mensaje en WhatsApp.',
            data: JSON.stringify({ channel: 'whatsapp', messageId: message.id }),
          })
        }
      }
      if (!text) {
        if (activeEventId) await db.whatsAppWebhookEvent.update({ where: { id: activeEventId }, data: { status: 'processed', processedAt: new Date() } })
        activeEventId = null
        continue
      }
      const phone = normalizePhone(message.from)
      if (!phone) {
        if (activeEventId) await db.whatsAppWebhookEvent.update({ where: { id: activeEventId }, data: { status: 'processed', processedAt: new Date() } })
        activeEventId = null
        continue
      }
      const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name || null

      // find-or-create Client por teléfono (aislado por org)
      const client = await findOrCreateChannelClient({ orgId: matchedOrgId, platformKey: phone, name: profileName, source: 'whatsapp' })

      await recordTimelineEvent({
        orgId: matchedOrgId,
        clientId: client?.id || null,
        type: 'whatsapp',
        title: isVoice ? `Nota de voz de ${profileName || phone} (transcrita)` : isImage ? `Imagen de ${profileName || phone}${imageAnalyzed ? ' (analizada)' : ' (requiere revisión)'}` : `Mensaje recibido de ${profileName || phone}`,
        description: text.slice(0, 500),
        metadata: { from: phone, direction: 'in', messageId: message.id, ...(isVoice ? { voice: true } : {}), ...(isImage ? { image: true, analyzed: imageAnalyzed } : {}) },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId: matchedOrgId,
          type: 'message_received',
          payload: { channel: 'whatsapp', from: phone, text, conversationId: phone, clientId: client?.id },
        })
      } catch (err) {
        console.error('[whatsapp webhook] workflows', err)
      }

      // Auto-respuesta IA
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: matchedOrgId }, select: { autoReplyEnabled: true } })
      if ((nicho?.autoReplyEnabled ?? true) && (!isImage || imageAnalyzed)) {
        await llmReplyOrNotification({
          orgId: matchedOrgId,
          clientId: client?.id || null,
          channelLabel: 'WhatsApp',
          incomingText: text,
          handoffKeywords: await getHandoffKeywords(matchedOrgId),
          nichoContext: await buildNichoContext(matchedOrgId),
          send: async (reply) => {
            if (matchedCloudToken && matchedPhoneId) {
              const sent = await sendWhatsAppCloud({ token: matchedCloudToken, phoneId: matchedPhoneId, to: phone, text: reply })
              await recordTimelineEvent({
                orgId: matchedOrgId,
                clientId: client?.id || null,
                type: 'whatsapp',
                title: 'Respuesta automática del agente IA',
                description: reply.slice(0, 500),
                metadata: { to: phone, direction: 'out', delivered: sent.ok, via: 'cloud-api' },
                source: 'agent',
              })
            } else {
              // Sin Cloud token: la respuesta queda registrada en el timeline para envío manual
              await recordTimelineEvent({
                orgId: matchedOrgId,
                clientId: client?.id || null,
                type: 'whatsapp',
                title: 'Respuesta sugerida por el agente IA (sin envío automático)',
                description: reply.slice(0, 500),
                metadata: { to: phone, direction: 'out', delivered: false, via: 'timeline' },
                source: 'agent',
              })
            }
          },
        })
      }
      if (activeEventId) {
        await db.whatsAppWebhookEvent.update({
          where: { id: activeEventId },
          data: { status: 'processed', processedAt: new Date(), lastError: null },
        })
        activeEventId = null
      }
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    if (activeEventId) {
      await db.whatsAppWebhookEvent.updateMany({
        where: { id: activeEventId, status: 'processing' },
        data: { status: 'failed', lastError: 'processing_failed' },
      }).catch(() => undefined)
    }
    console.error('[whatsapp webhook]', err instanceof Error ? err.message : 'unknown error')
    return json({ ok: false, processed: false }, { status: 500 })
  }
}

/**
 * Claim a Cloud API message exactly once under normal concurrency. A processing
 * lease older than five minutes can be reclaimed after a crashed worker.
 */
async function claimWhatsAppWebhookEvent(orgId: string, providerMessageId: string): Promise<{ claimed: boolean; id: string }> {
  const now = new Date()
  try {
    const created = await db.whatsAppWebhookEvent.create({
      data: { organizationId: orgId, providerMessageId, status: 'processing', attempts: 1, lockedAt: now },
      select: { id: true },
    })
    return { claimed: true, id: created.id }
  } catch (error) {
    const existing = await db.whatsAppWebhookEvent.findUnique({
      where: { organizationId_providerMessageId: { organizationId: orgId, providerMessageId } },
      select: { id: true, status: true, lockedAt: true },
    })
    if (!existing) throw error
    if (existing.status === 'processed') return { claimed: false, id: existing.id }
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000)
    if (existing.status === 'processing' && existing.lockedAt > staleBefore) {
      return { claimed: false, id: existing.id }
    }
    const reclaimed = await db.whatsAppWebhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: 'failed' },
          { status: 'processing', lockedAt: { lt: staleBefore } },
        ],
      },
      data: { status: 'processing', attempts: { increment: 1 }, lockedAt: now, lastError: null },
    })
    return { claimed: reclaimed.count === 1, id: existing.id }
  }
}

async function isValidCloudImage(bytes: Buffer, mime: string): Promise<boolean> {
  if (mime === 'image/jpeg' && !(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return false
  if (mime === 'image/png' && !(bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) return false
  if (mime === 'image/gif' && !(bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')))) return false
  if (mime === 'image/webp' && !(bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')) return false
  try {
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
    const expected: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
    return metadata.format === expected[mime] && Boolean(metadata.width && metadata.height)
  } catch {
    return false
  }
}

/** Descarga media desde Graph API con host HTTPS permitido y límite de bytes. */
async function downloadWaCloudMedia({ token, mediaId, maxBytes = 25 * 1024 * 1024 }: { token: string; mediaId: string; maxBytes?: number }): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(mediaId)) throw new Error('Identificador de media inválido')
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!metaRes.ok) throw new Error(`graph media ${metaRes.status}`)
  const meta = (await metaRes.json()) as { url?: string }
  if (!meta.url) throw new Error('graph media sin url')
  const mediaUrl = new URL(meta.url)
  const allowedHosts = ['lookaside.fbsbx.com', 'fbcdn.net', 'graph.facebook.com']
  if (mediaUrl.protocol !== 'https:' || mediaUrl.username || mediaUrl.password || (mediaUrl.port && mediaUrl.port !== '443') || !allowedHosts.some((host) => mediaUrl.hostname === host || mediaUrl.hostname.endsWith(`.${host}`))) {
    throw new Error('Host de media de Meta no permitido')
  }

  const binRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!binRes.ok) throw new Error(`descarga de media ${binRes.status}`)
  const declared = Number(binRes.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('El archivo multimedia excede el tamaño máximo permitido')
  if (!binRes.body) throw new Error('Respuesta multimedia vacía')
  const reader = binRes.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('El archivo multimedia excede el tamaño máximo permitido')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}
