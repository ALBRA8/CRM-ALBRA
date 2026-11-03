/**
 * Saneamiento del historial multi-turno que envían los daemons de canal
 * (WhatsApp/WHATSPOWER → /api/whatsapp/auto-reply y /api/chat).
 *
 * Contrato de seguridad (tests/integration/channel-autoresponder.test.ts y
 * chat-whatsapp-channel.test.ts): SOLO pasan mensajes user/assistant con
 * contenido no vacío. Nada del historial puede inyectar instrucciones de
 * sistema (roles 'system' descartados) ni basura (no-objetos, null, vacíos).
 */

const MAX_HISTORY = 20

export function sanitizeHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (m): m is { role: string; content: string } =>
        !!m && typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string' &&
        (m as { content: string }).content.trim().length > 0
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.trim().slice(0, 2000) }))
}
