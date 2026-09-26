import { parseJson } from './shared'

/**
 * Genera la descripción legible de un ActivityLog en el momento de lectura
 * (ActivityLog guarda action/entity/details; la frase se compone aquí).
 */

const VERBS: Record<string, string> = {
  created: 'Creó',
  updated: 'Actualizó',
  deleted: 'Eliminó',
  login: 'Inició sesión',
  registered: 'Registró',
  stage_changed: 'Cambió la etapa de',
  status_change: 'Cambió el estado de',
  note_added: 'Añadió una nota en',
  sent: 'Envió',
  exported: 'Exportó',
  ran_automation: 'Ejecutó',
  deactivated: 'Desactivó',
}

const ENTITY_LABELS: Record<string, string> = {
  client: 'el cliente',
  opportunity: 'la oportunidad',
  quote: 'la cotización',
  reservation: 'la reserva',
  transaction: 'la transacción',
  service: 'el servicio',
  user: 'el miembro',
  custom_field: 'el campo personalizado',
  custom_field_value: 'los campos personalizados de',
  template: 'la plantilla',
  automation: 'la automatización',
  notification: 'la notificación',
  settings: 'la configuración',
  organization: 'la organización',
}

export function describeActivity(action: string, entity: string, detailsRaw: string | null | undefined): string {
  const details = parseJson<Record<string, unknown>>(detailsRaw ?? null, {})
  const name = [details.name, details.title, details.number].find((v) => typeof v === 'string' && v) as string | undefined
  const verb = VERBS[action] ?? action
  const entityLabel = ENTITY_LABELS[entity] ?? entity

  if (action === 'login' || action === 'registered') {
    return action === 'login' ? 'Inició sesión en el CRM' : 'Se registró una nueva sesión'
  }
  const label = name ? `${entityLabel} "${name}"` : entityLabel
  const extra = typeof details.from === 'string' && typeof details.to === 'string' ? ` (${details.from} → ${details.to})` : ''
  return `${verb} ${label}${extra}`
}
