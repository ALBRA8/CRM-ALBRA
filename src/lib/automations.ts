/**
 * Helpers de automatizaciones compartidos entre las rutas /api/automations*.
 * El motor real vive en src/lib/workflow-engine.ts — aquí solo mapeos del UI
 * y normalización de los campos JSON (triggerConfig / conditions / actions).
 */

export const ENGINE_TRIGGERS = [
  'manual',
  'client_created',
  'opportunity_stage_changed',
  'message_received',
  'reservation_created',
  'quote_status_changed',
  'schedule',
] as const

export type EngineTrigger = (typeof ENGINE_TRIGGERS)[number]

/** Alias del formulario del UI → triggers del workflow-engine */
export const UI_TRIGGER_MAP: Record<string, EngineTrigger> = {
  days_inactive: 'schedule',
  before_appointment: 'schedule',
  after_service: 'schedule',
  stage_change: 'opportunity_stage_changed',
}

export function normalizeTrigger(raw: unknown): string | null {
  const trigger = String(raw ?? '').trim()
  if (!trigger) return null
  if ((ENGINE_TRIGGERS as readonly string[]).includes(trigger)) return trigger
  return UI_TRIGGER_MAP[trigger] ?? null
}

/** Normaliza conditions/actions (objeto | array | string JSON) a string JSON */
export function toJsonString(input: unknown, fallback: string | null): string | null {
  if (input === undefined || input === null || input === '') return fallback
  if (typeof input === 'string') {
    try {
      JSON.parse(input)
      return input
    } catch {
      return fallback
    }
  }
  try {
    return JSON.stringify(input)
  } catch {
    return fallback
  }
}

/** El motor espera actions como ARRAY de { type, config }; normaliza objeto suelto */
export function normalizeActions(input: unknown, message?: string | null): string | null {
  let parsed: unknown = input
  if (typeof input === 'string' && input.trim()) {
    try {
      parsed = JSON.parse(input)
    } catch {
      return null
    }
  }
  if (!parsed && message) parsed = { type: 'send_message' }
  if (!parsed) return null
  let arr: Array<{ type: string; config?: Record<string, unknown> }>
  if (Array.isArray(parsed)) {
    arr = parsed.map((a) => {
      const item = (a ?? {}) as Record<string, unknown>
      const config = (item.config && typeof item.config === 'object' ? { ...(item.config as Record<string, unknown>) } : { ...item }) as Record<string, unknown>
      delete config.type
      return { type: String(item.type || 'send_message'), config }
    })
  } else if (typeof parsed === 'object') {
    const item = { ...(parsed as Record<string, unknown>) }
    const type = String(item.type || 'send_message')
    delete item.type
    if (message) item.body = message
    arr = [{ type, config: item }]
  } else {
    return null
  }
  return JSON.stringify(arr)
}

export function intervalMinutesFrom(triggerConfig: unknown): number {
  try {
    const cfg = typeof triggerConfig === 'string' ? JSON.parse(triggerConfig) : triggerConfig
    const minutes = Number((cfg as Record<string, unknown>)?.intervalMinutes)
    return Number.isFinite(minutes) && minutes >= 5 ? minutes : 60
  } catch {
    return 60
  }
}

/** Shape combinado: campos del frontend (type/trigger/message) + campos del schema */
export interface SerializedAutomationRun {
  status: string
  error: string | null
  startedAt: Date
  finishedAt: Date | null
  resumeAt: Date | null
  currentStep: number
  stepStates: string | null
}

export function serializeAutomation(
  a: {
  id: string
  name: string
  description: string | null
  category: string
  triggerType: string
  triggerConfig: string | null
  conditions: string | null
  actions: string | null
  isActive: boolean
  runCount: number
  lastRunAt: Date | null
  nextRunAt: Date | null
  createdAt: Date
  },
  lastRun?: SerializedAutomationRun | null
) {
  let message: string | null = null
  try {
    const cfg = a.triggerConfig ? (JSON.parse(a.triggerConfig) as Record<string, unknown>) : null
    message = (cfg?.message as string) || null
  } catch {
    message = null
  }
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    // Shape del frontend:
    type: a.category,
    trigger: a.triggerType,
    conditions: a.conditions,
    actions: a.actions || '',
    message,
    isActive: a.isActive,
    runCount: a.runCount,
    lastRunAt: a.lastRunAt,
    // Shape del schema (compatibilidad):
    category: a.category,
    triggerType: a.triggerType,
    triggerConfig: a.triggerConfig,
    nextRunAt: a.nextRunAt,
    createdAt: a.createdAt,
    // Última ejecución con estado por paso (debugging estilo Twenty stepLogs)
    lastRun: lastRun
      ? {
          status: lastRun.status,
          error: lastRun.error,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          resumeAt: lastRun.resumeAt,
          currentStep: lastRun.currentStep,
          steps: safeParseSteps(lastRun.stepStates),
        }
      : null,
  }
}

function safeParseSteps(raw: string | null): Array<{ type: string; status: string; error?: string; ms?: number }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
