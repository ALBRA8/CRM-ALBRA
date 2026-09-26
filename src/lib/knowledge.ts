import { db } from './db'

/**
 * Construye el bloque "CONOCIMIENTO DEL NEGOCIO" a partir de las entradas
 * activas de la base de conocimiento de la organización. Se inyecta en los
 * system prompts del agente (canales WhatsApp/Telegram/Instagram y Chat AI).
 */
export async function buildKnowledgeContext(orgId: string): Promise<string> {
  const entries = await db.knowledge.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })
  if (entries.length === 0) return ''

  const blocks = entries.map((e) => {
    const label = e.category !== 'general' ? `[${e.category.toUpperCase()}] ` : ''
    return `${label}${e.title}:\n${e.content}`
  })
  return `\n\nCONOCIMIENTO DEL NEGOCIO (úsalo para responder con precisión; no lo menciones textualmente al cliente):\n${blocks.join('\n\n')}`
}
