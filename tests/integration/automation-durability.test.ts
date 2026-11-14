import { describe, expect, it, vi } from 'vitest'

/**
 * DURABILIDAD DE AUTOMATIZACIONES (§14 del cierre): idempotencia ante
 * reentregas, claim atómico del scheduler y sweeper de runs huérfanos.
 * El setup global mockea '@/lib/workflow-engine' (blindaje de canales);
 * aquí usamos el motor REAL vía importActual para probar sus garantías.
 */
const real = await vi.importActual<typeof import('@/lib/workflow-engine')>('@/lib/workflow-engine')
import { runDueJobs } from '@/lib/scheduler'
import { db } from '@/lib/db'
import { FIX } from '../helpers'

const AUTOMATION_BASE = {
  organizationId: 'org-a',
  conditions: '[]',
  actions: '[]',
  isActive: true,
}

describe('seguridad del formato de correo workflow', () => {
  it('escapa HTML no confiable y conserva saltos de línea para el renderizador', () => {
    expect(real.escapeWorkflowEmailHtml('<img src=x onerror="alert(1)">&\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;')
  })
})

describe('idempotencia de runs (webhook re-entregado ≠ doble ejecución)', () => {
  it('el mismo evento dos veces → el segundo es deduplicated (1 solo run)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem', triggerType: 'client_created' } })
    try {
      const payload = { id: 'client-a1', name: 'Cliente Alpha' }
      const r1 = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      const r2 = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      expect(r1[0]?.status).toBe('success')
      expect(r2[0]?.status).toBe('deduplicated')
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(1)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('eventos distintos del mismo tipo SÍ ejecutan (claves distintas)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem multi', triggerType: 'client_created' } })
    try {
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload: { id: 'client-a1' } })
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload: { id: 'client-a2' } })
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(2)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('re-entrega del MISMO evento minutos después sigue deduplicada (garantía permanente)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem ventana', triggerType: 'client_created' } })
    try {
      const payload = { id: 'client-a1' }
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      // Envejece el run 3 minutos: la re-entrega del MISMO eventId SIGUE siendo
      // el mismo evento → no vuelve a ejecutar (doble WhatsApp jamás).
      await db.automationRun.updateMany({
        where: { automationId: auto.id },
        data: { startedAt: new Date(Date.now() - 180_000) },
      })
      const again = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      expect(again[0]?.status).toBe('deduplicated')
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(1)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})

describe('aislamiento de contexto en acciones workflow', () => {
  it('no acepta destinatarios de email/teléfono inyectados en el payload sin clientId validado', async () => {
    const marker = `workflow-unlinked-recipient-${Date.now()}`
    const previousFlag = process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
    delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
    const auto = await db.automation.create({
      data: {
        ...AUTOMATION_BASE,
        name: 'Workflow unlinked recipient',
        triggerType: 'client_created',
        actions: JSON.stringify([{ type: 'send_email', config: { body: marker } }]),
      },
    })
    try {
      const results = await real.runWorkflowsForTrigger({
        orgId: 'org-a',
        type: 'client_created',
        payload: {
          id: marker,
          email: 'attacker@example.invalid',
          phone: '+15550000000',
          clientName: 'Contacto ajeno',
        },
      })
      expect(results[0]?.status).toBe('success')
      const notification = await db.notification.findFirst({
        where: { organizationId: 'org-a', title: { contains: 'Mensaje email PENDIENTE' } },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      expect(notification!.body).not.toContain('attacker@example.invalid')
      const data = JSON.parse(notification!.data || '{}') as Record<string, unknown>
      expect(data.email).toBeNull()
      expect(data.phone).toBeNull()
      expect(data.clientId).toBeNull()
      await db.notification.deleteMany({ where: { id: notification!.id } })
      const emailTimeline = await db.timelineEvent.findFirst({ where: { organizationId: 'org-a', type: 'email', title: { contains: 'destinatario no disponible' } }, orderBy: { createdAt: 'desc' } })
      if (emailTimeline) await db.timelineEvent.delete({ where: { id: emailTimeline.id } })
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
      if (previousFlag === undefined) delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
      else process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = previousFlag
    }
  })

  it('un clientId de otra organización no filtra teléfono, email ni vínculo al timeline', async () => {
    const auto = await db.automation.create({
      data: {
        ...AUTOMATION_BASE,
        name: 'Workflow foreign client context',
        triggerType: 'client_created',
        actions: JSON.stringify([{ type: 'send_whatsapp', config: { body: 'Prueba de aislamiento {{clientName}}' } }]),
      },
    })
    try {
      const results = await real.runWorkflowsForTrigger({
        orgId: 'org-a',
        type: 'client_created',
        payload: { id: 'foreign-client-context-event', clientId: FIX.clientB1.id },
      })
      expect(results[0]?.status).toBe('success')
      const notification = await db.notification.findFirst({
        where: { organizationId: 'org-a', title: { contains: 'Mensaje whatsapp PENDIENTE' } },
        orderBy: { createdAt: 'desc' },
      })
      expect(notification).not.toBeNull()
      const notificationData = JSON.parse(notification!.data || '{}') as Record<string, unknown>
      expect(notificationData.clientId).toBeNull()
      expect(notificationData.phone).toBeNull()
      expect(notificationData.email).toBeNull()
      const timeline = await db.timelineEvent.findFirst({
        where: { organizationId: 'org-a', type: 'whatsapp', title: { contains: 'destinatario no disponible' } },
        orderBy: { createdAt: 'desc' },
      })
      expect(timeline).not.toBeNull()
      expect(timeline!.clientId).toBeNull()
      await db.notification.deleteMany({ where: { id: notification!.id } })
      await db.timelineEvent.deleteMany({ where: { id: timeline!.id } })
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})

describe('scheduler: claim atómico y recovery', () => {
  it('runDueJobs ejecuta UNA vez y mueve nextRunAt; el segundo pase no repite', async () => {
    const auto = await db.automation.create({
      data: { ...AUTOMATION_BASE, name: 'Sched', triggerType: 'schedule', triggerConfig: '{"intervalMinutes":60}', nextRunAt: new Date(Date.now() - 60_000) },
    })
    try {
      const first = await runDueJobs()
      expect(first.processed).toBeGreaterThanOrEqual(1)
      const after = await db.automation.findUnique({ where: { id: auto.id } })
      expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now()) // ya no está vencida
      const second = await runDueJobs()
      const scheduleRunsSecond = (second.results as Array<{ automationId?: string }>).filter((r) => r.automationId === auto.id).length
      expect(scheduleRunsSecond).toBe(0)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('sweeper: runs running huérfanos (crash) quedan failed al pasar el scheduler', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Orfan', triggerType: 'client_created' } })
    const run = await db.automationRun.create({
      data: { organizationId: 'org-a', automationId: auto.id, status: 'running', startedAt: new Date(Date.now() - 20 * 60_000) },
    })
    try {
      await runDueJobs()
      const after = await db.automationRun.findUnique({ where: { id: run.id } })
      expect(after!.status).toBe('failed')
      expect(after!.error).toContain('interrupted')
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('resumeWaitingRuns: solo una instancia reanuda; tras reanudar, no re-procesa', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Wait', triggerType: 'client_created' } })
    const run = await db.automationRun.create({
      data: { organizationId: 'org-a', automationId: auto.id, status: 'waiting', input: '{}', currentStep: 0, resumeAt: new Date(Date.now() - 1000) },
    })
    try {
      const n1 = await real.resumeWaitingRuns()
      expect(n1).toBeGreaterThanOrEqual(1)
      const n2 = await real.resumeWaitingRuns()
      expect(n2).toBe(0) // ya no hay runs vencidos: no se re-ejecuta dos veces
      const after = await db.automationRun.findUnique({ where: { id: run.id } })
      expect(after!.status).toBe('success')
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})


describe('semántica de pasos con outbox durable', () => {
  it('registra queued y no success cuando la intención externa queda persistida', async () => {
    const auto = await db.automation.create({
      data: {
        ...AUTOMATION_BASE,
        name: 'Workflow outbox step state',
        triggerType: 'client_created',
        actions: JSON.stringify([{ type: 'send_telegram', config: { chatId: 'test-chat-id', body: 'mensaje de prueba' } }]),
      },
    })
    try {
      const result = await real.runWorkflowsForTrigger({
        orgId: 'org-a',
        type: 'client_created',
        payload: { id: 'workflow-outbox-step-state-event' },
      })
      expect(result[0]?.status).toBe('success')
      const run = await db.automationRun.findFirst({
        where: { automationId: auto.id },
        orderBy: { startedAt: 'desc' },
      })
      expect(run).not.toBeNull()
      expect(JSON.parse(run!.stepStates || '[]')).toMatchObject([{ type: 'send_telegram', status: 'queued' }])
      expect(JSON.parse(run!.output || '[]')).toMatchObject([{ queued: true, pending: true, channel: 'telegram' }])
      const intent = await db.workflowOutboundMessage.findFirst({ where: { automationRunId: run!.id } })
      expect(intent).toMatchObject({ status: 'queued', channel: 'telegram' })
      if (intent) await db.workflowOutboundMessage.delete({ where: { id: intent.id } })
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})
