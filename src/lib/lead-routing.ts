import { db } from './db'

/**
 * Round-robin de leads (Fase 2 del plan maestro).
 *
 * Reparte cada lead entrante entre los usuarios ACTIVOS de la organización
 * con la menor carga acumulada. Estrategia "balanced round-robin":
 *   ORDER BY leadCount ASC, lastLeadAt ASC (nulls primero), createdAt ASC
 *
 * ¿Por qué no un índice rotatorio simple? Porque este criterio es
 * auto-reparante: si se agrega/queda/desactiva un miembro, el reparto se
 * re-equilibra solo hacia el que menos leads tiene, sin estado externo
 * (importante con scheduler en memoria y SQLite — limitaciones conocidas).
 *
 * REGLAS DE SEGURIDAD:
 *  - Nunca lanza: si algo falla, devuelve null y el lead queda sin asignar.
 *    La captura del lead NUNCA debe bloquearse por la asignación.
 *  - Respeta Settings.autoAssignLeads (toggle por organización).
 *  - Aislado por organizationId (multi-tenant estricto).
 *  - Solo usuarios isActive = true de la org (owner incluido: en equipos
 *    pequeños el dueño también atiende).
 */
export async function assignLeadRoundRobin(
  organizationId: string
): Promise<string | null> {
  try {
    const settings = await db.settings.findUnique({
      where: { organizationId },
      select: { autoAssignLeads: true },
    })
    // Por defecto (sin fila de Settings) la asignación automática está activa
    if (settings && !settings.autoAssignLeads) return null

    const candidates = await db.user.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ leadCount: 'asc' }, { lastLeadAt: 'asc' }, { createdAt: 'asc' }],
      take: 1,
      select: { id: true },
    })
    if (candidates.length === 0) return null

    const picked = candidates[0]
    await db.user.update({
      where: { id: picked.id },
      data: { leadCount: { increment: 1 }, lastLeadAt: new Date() },
    })
    return picked.id
  } catch (err) {
    console.error('[lead-routing] round-robin falló (lead queda sin asignar)', err)
    return null
  }
}
