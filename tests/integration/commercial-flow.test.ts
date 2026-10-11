import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { POST as clientsPOST } from '@/app/api/clients/route'
import { db } from '@/lib/db'
import { resumeWaitingRuns } from '@/lib/workflow-engine'
import { llmChat } from '@/lib/ai'
import { FIX, jsonBody, req, tokenA } from '../helpers'

/**
 * FLUJO COMERCIAL E2E (estabilización — criterio del dueño del proyecto):
 *
 *   "Nuevo cliente → crear oportunidad → enviar WhatsApp → esperar 1 día
 *    → hacer seguimiento"
 *
 * Usa el CAMINO REAL de la app:
 *  1. POST /api/clients (API autenticada) dispara client_created en el motor.
 *  2. El motor crea la oportunidad (BD real), envía WhatsApp (fetch al daemon
 *     mockeado → entrega OK) y llega al 'wait' 1 día → run 'waiting' durable.
 *  3. Se simula que pasó el día (resumeAt al pasado) y resumeWaitingRuns()
 *     (el mismo barrido del scheduler) reanuda: ai_followup redacta (LLM
 *     mockeado) y el run termina 'success'.
 * Auditoría completa: AutomationRun con stepStates por paso, notificaciones,
 * timeline de la automatización.
 */

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, llmChat: vi.fn() }
})
const mockedLlm = vi.mocked(llmChat)

// RESTAURA el motor REAL para este archivo: el setup global lo mockea a no-op
// como blindaje anti-envíos; aquí la seguridad la dan los mocks de llmChat y
// del fetch del daemon (infraestructura de canales external no se toca).
vi.mock('@/lib/workflow-engine', async (importOriginal) => {
  return (await importOriginal<typeof import('@/lib/workflow-engine')>()) as typeof import('@/lib/workflow-engine')
})

const { daemonFetch } = vi.hoisted(() => ({ daemonFetch: vi.fn(async (_input?: unknown, _init?: unknown) => new Response(JSON.stringify({ success: true, messageId: 'wamid.TEST' }), { status: 200 })) }))

const AUTO_ID = 'auto-flujo-comercial'
const NEW_CLIENT_NAME = 'Comercial E2E Cliente'
let newClientId = ''
let runId = ''

beforeAll(async () => {
  mockedLlm.mockReset()
  // Automatización EXACTA del flujo comercial del dueño
  await db.automation.create({
    data: {
      id: AUTO_ID,
      organizationId: FIX.orgA.id,
      name: 'Bienvenida comercial: oportunidad + WhatsApp + seguimiento 1 día',
      triggerType: 'client_created',
      isActive: true,
      createdById: FIX.userA.id,
      actions: JSON.stringify([
        { type: 'create_opportunity', config: { title: 'Oportunidad para {{clientName}}', amount: 1500 } },
        { type: 'send_whatsapp', config: { body: 'Hola {{clientName}}, bienvenido a Albra. Te contactamos para conocerte mejor.' } },
        { type: 'wait', config: { days: 1 } },
        { type: 'ai_followup', config: { instruction: 'Redacta un seguimiento cordial del día 1.' } },
      ]),
    },
  })
  // fetch: SOLO intercepta el daemon de WhatsApp; el resto de URLs pasan al fetch real
  const realFetch = globalThis.fetch.bind(globalThis)
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes(':3002/send')) return daemonFetch(input, init) as unknown as Promise<Response>
    return realFetch(input as RequestInfo, init as RequestInit)
  })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Flujo comercial: cliente → oportunidad → WhatsApp → wait 1 día → seguimiento', () => {
  it('paso 1-2: cliente nuevo dispara el motor; oportunidad + WhatsApp ejecutados; run queda waiting por el wait de 1 día', async () => {
    const res = await clientsPOST(req('/api/clients', { method: 'POST', token: tokenA(), body: { name: NEW_CLIENT_NAME, phone: '+57 319 000 0001' } }))
    expect(res.status).toBe(201)
    const { client } = (await res.json()) as { client: { id: string } }
    newClientId = client.id
    expect(newClientId).toBeTruthy()

    const run = await db.automationRun.findFirst({ where: { automationId: AUTO_ID, organizationId: FIX.orgA.id }, orderBy: { startedAt: 'desc' } })
    expect(run).toBeTruthy()
    runId = run!.id

    // 'waiting' durable: el wait de 1 día pausa el run con resumeAt
    expect(run!.status).toBe('waiting')
    expect(run!.resumeAt).toBeTruthy()
    const waitMs = run!.resumeAt!.getTime() - Date.now()
    expect(waitMs).toBeGreaterThan(20 * 60 * 60 * 1000) // > 20h restantes
    expect(waitMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

    const states = JSON.parse(run!.stepStates || '[]') as Array<{ type: string; status: string }>
    expect(states).toHaveLength(3)
    expect(states[0].type).toBe('create_opportunity')
    expect(states[0].status).toBe('success')
    expect(states[1].type).toBe('send_whatsapp')
    expect(states[1].status).toBe('success')
    expect(states[2].type).toBe('wait')
    expect(states[2].status).toBe('waiting')
    expect(run!.currentStep).toBe(3)

    // La oportunidad SE CREÓ de verdad y está ligada al cliente
    const opp = await db.opportunity.findFirst({ where: { organizationId: FIX.orgA.id, clientId: newClientId, source: 'automation' } })
    expect(opp).toBeTruthy()
    expect(opp!.title).toBe(`Oportunidad para ${NEW_CLIENT_NAME}`)

    // WhatsApp: envío REAL interceptado (contrato daemon {to,text})
    expect(daemonFetch).toHaveBeenCalledTimes(1)
    const [url, init] = daemonFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/send')
    const sentBody = JSON.parse(String(init.body)) as { to: string; text: string }
    expect(sentBody.to.replace(/\D/g, '')).toBe('573190000001')
    expect(sentBody.text).toContain(NEW_CLIENT_NAME)
  })

  it('paso 3: al vencer el día, el scheduler reanuda el run y el seguimiento IA se ejecuta → success', async () => {
    // Simula que pasó 1 día (el scheduler real solo compara resumeAt <= now)
    await db.automationRun.update({ where: { id: runId }, data: { resumeAt: new Date(Date.now() - 1000) } })
    mockedLlm.mockResolvedValueOnce('Hola de nuevo, ¿pudiste revisar nuestra propuesta? Quedo atento.')

    const processed = await resumeWaitingRuns()
    expect(processed).toBeGreaterThanOrEqual(1)

    const run = await db.automationRun.findUnique({ where: { id: runId } })
    expect(run!.status).toBe('success')
    expect(run!.finishedAt).toBeTruthy()

    const states = JSON.parse(run!.stepStates || '[]') as Array<{ type: string; status: string }>
    expect(states).toHaveLength(4)
    expect(states[3].type).toBe('ai_followup')
    expect(states[3].status).toBe('success')

    // El seguimiento IA queda como notificación revisable para el equipo
    const notif = await db.notification.findFirst({
      where: { organizationId: FIX.orgA.id, type: 'agent', title: 'Seguimiento IA listo para revisión' },
      orderBy: { createdAt: 'desc' },
    })
    expect(notif).toBeTruthy()
    expect(notif!.body).toContain('Hola de nuevo')

    // El contexto del followup incluía al cliente real
    const sysCall = mockedLlm.mock.calls[0]
    expect(String(sysCall[1][1].content)).toContain(NEW_CLIENT_NAME)
  })

  it('auditoría: el motor dejó timeline y notificación del WhatsApp enviado', async () => {
    const tl = await db.timelineEvent.findFirst({
      where: { organizationId: FIX.orgA.id, clientId: newClientId, source: 'automation', type: 'whatsapp' },
      orderBy: { createdAt: 'desc' },
    })
    expect(tl).toBeTruthy()
    expect(tl!.title).toContain('automatización')
    expect(tl!.title).not.toContain('no entregado')

    const notif = await db.notification.findFirst({
      where: { organizationId: FIX.orgA.id, type: 'automation', title: { contains: 'whatsapp' } },
      orderBy: { createdAt: 'desc' },
    })
    expect(notif).toBeTruthy()
    expect(notif!.title).toContain('enviado')
  })
})
