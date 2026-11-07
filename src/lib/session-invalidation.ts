/**
 * session-invalidation.ts — Revocación de sesiones PERSISTENTE por `tokenVersion`.
 * (segunda reparación integral 2026-11-06 — orden §2.A)
 *
 * Causa raíz corregida: la versión anterior usaba un Map EN MEMORIA — no era
 * persistente, no se compartía entre instancias y se perdía al reiniciar.
 *
 * Mecanismo actual (autoridad en la base de datos, sin Redis ni pub/sub):
 *  - Cada User lleva un contador `tokenVersion` (Prisma, default 0).
 *  - Todo JWT lleva el claim `tv` con la versión vigente al firmarse.
 *  - Las guardas async de src/lib/auth.ts (requireAuth y derivadas) consultan
 *    la BD en cada petición y RECHAZAN el token si `tv` !== tokenVersion vigente,
 *    si el usuario no existe o si dejó de estar activo (fail-closed).
 *  - Revocar = `bumpTokenVersion(userId)`: un UPDATE atómico de incremento.
 *
 * Propiedades demostradas en tests/integration/session-revocation.test.ts:
 *  - tras REINICIAR el servidor (nuevo registro de módulos), un JWT anterior
 *    sigue siendo rechazado (el estado NO vive en memoria de proceso);
 *  - una SEGUNDA INSTANCIA (otro registro de módulos, sin comunicación alguna)
 *    ve la revocación al instante (solo comparten la BD);
 *  - la desactivación de un empleado y el reset de contraseña revocan al momento.
 */

import { db } from './db'

/**
 * Revoca las sesiones de un usuario de forma PERSISTENTE: incrementa
 * atómicamente su `tokenVersion` en la base de datos y devuelve la versión
 * nueva. Los JWT existentes (con la versión anterior en `tv`) dejan de ser
 * aceptados por las guardas de autenticación, en este proceso y en cualquiera
 * otro que comparta la misma base de datos.
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const user = await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  })
  return user.tokenVersion
}
