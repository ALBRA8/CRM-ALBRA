/**
 * CUARTA FASE CORRECTIVA — REFERENCIAS HISTÓRICAS ENTRE ORGANIZACIONES.
 *
 * Los datos históricos inconsistentes (NO producibles por la API: p. ej. una
 * oportunidad antigua cuyo `clientId` apunta a un cliente de otra organización)
 * no deben filtrar PII de la otra org a través de las relaciones incluidas
 * (`include: { client: ... }` sigue la relación por id SIN importar la org).
 *
 * Regla: si el cliente incluido pertenece a otra organización, se elimina del
 * resultado (client → null). El `clientId` propio (referencia histórica de la
 * propia org, necesaria para auditar/corregir el dato) se conserva.
 */

type WithClient<C> = { client: C | null }

/** Elimina el cliente incluido si pertenece a otra organización (fail-closed). */
export function stripForeignClient<T extends WithClient<{ organizationId?: string } | null>>(row: T, orgId: string): T {
  if (row.client && row.client.organizationId !== orgId) {
    return { ...row, client: null }
  }
  return row
}

/** Variante para listados. */
export function stripForeignClients<T extends WithClient<{ organizationId?: string } | null>>(rows: T[], orgId: string): T[] {
  return rows.map((r) => stripForeignClient(r, orgId))
}
