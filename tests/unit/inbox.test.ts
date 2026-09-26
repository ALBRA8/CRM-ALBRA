import { describe, expect, it } from 'vitest'
import { makeInboxKey, parseInboxKey, timelineToMessages, type InboxConversation } from '@/lib/inbox'

/**
 * Funciones puras de la bandeja omnicanal (Fase 4):
 *  - Keys estables "wa:<id>" | "tg:<id>" | "ig:<id>" con parseo fail-closed.
 *  - Normalización de TimelineEvent → InboxMessage (dirección, remitente, orden).
 *  - Merge determinista de listas por actividad reciente.
 */

describe('makeInboxKey / parseInboxKey', () => {
  it('hace roundtrip por los 3 canales', () => {
    expect(parseInboxKey(makeInboxKey('whatsapp', 'conv-1'))).toEqual({ channel: 'whatsapp', id: 'conv-1' })
    expect(parseInboxKey(makeInboxKey('telegram', 'client-2'))).toEqual({ channel: 'telegram', id: 'client-2' })
    expect(parseInboxKey(makeInboxKey('instagram', 'client-3'))).toEqual({ channel: 'instagram', id: 'client-3' })
  })

  it('acepta ids con caracteres de cuid, teléfono y chat id negativo', () => {
    expect(parseInboxKey('wa:cmuhwmllp0002givy0mtqcz0i')?.id).toBe('cmuhwmllp0002givy0mtqcz0i')
    expect(parseInboxKey('wa:+573001112233')?.id).toBe('+573001112233')
    expect(parseInboxKey('tg:-100123456')?.id).toBe('-100123456')
  })

  it('rechaza (fail-closed) keys malformadas', () => {
    expect(parseInboxKey('')).toBeNull()
    expect(parseInboxKey('wa')).toBeNull()
    expect(parseInboxKey(':sin-prefix')).toBeNull()
    expect(parseInboxKey('wa:')).toBeNull()
    expect(parseInboxKey('fb:algo')).toBeNull()
    expect(parseInboxKey('wa:con espacio')).toBeNull()
    expect(parseInboxKey('wa:' + 'x'.repeat(300))).toBeNull()
    expect(parseInboxKey(null as unknown as string)).toBeNull()
    expect(parseInboxKey(42 as unknown as string)).toBeNull()
  })
})

describe('timelineToMessages', () => {
  const base = { title: 'Mensaje', source: 'integration' }

  it('normaliza dirección y remitente (in→contacto, out+agent→agente, out+manual→usuario)', () => {
    const now = new Date('2026-01-01T10:00:00Z')
    const msgs = timelineToMessages([
      { id: 'e1', description: 'hola', metadata: JSON.stringify({ direction: 'in' }), createdAt: now, ...base },
      { id: 'e2', title: 'Mensaje', description: 'respuesta IA', metadata: JSON.stringify({ direction: 'out' }), createdAt: now, source: 'agent' },
      { id: 'e3', title: 'Mensaje', description: 'respuesta humana', metadata: JSON.stringify({ direction: 'out' }), createdAt: now, source: 'manual' },
      { id: 'e4', description: 'sin metadata', metadata: null, createdAt: now, ...base },
    ])
    expect(msgs.map((m) => m.senderType)).toEqual(['contact', 'agent', 'user', 'contact'])
    expect(msgs.map((m) => m.direction)).toEqual(['in', 'out', 'out', 'in'])
  })

  it('ordena ascendente por fecha aunque los eventos lleguen al revés', () => {
    const msgs = timelineToMessages([
      { id: 'late', description: 'último', metadata: '{"direction":"in"}', createdAt: new Date('2026-01-02T00:00:00Z'), ...base },
      { id: 'early', description: 'primero', metadata: '{"direction":"in"}', createdAt: new Date('2026-01-01T00:00:00Z'), ...base },
    ])
    expect(msgs.map((m) => m.id)).toEqual(['early', 'late'])
  })

  it('metadata corrupta → se trata como entrante sin lanzar', () => {
    const msgs = timelineToMessages([
      { id: 'x', description: 'rompe', metadata: '{no-json', createdAt: new Date('2026-01-01T00:00:00Z'), ...base },
    ])
    expect(msgs[0].direction).toBe('in')
    expect(msgs[0].text).toBe('rompe')
  })
})

describe('orden del merge (invariante del listado)', () => {
  it('las conversaciones quedan por actividad reciente aunque entren por canal distinto', () => {
    const conv = (key: string, at: string | null): InboxConversation => ({
      key,
      channel: key.startsWith('wa:') ? 'whatsapp' : key.startsWith('tg:') ? 'telegram' : 'instagram',
      channelLabel: 'WhatsApp',
      contactName: key,
      contactHandle: 'x',
      clientId: null,
      lastMessage: '',
      lastMessageAt: at,
      lastMessageFrom: 'in',
      unreadCount: 0,
      isAutoReply: false,
    })
    const merged = [conv('wa:1', '2026-01-03T00:00:00Z'), conv('tg:2', '2026-01-05T00:00:00Z'), conv('ig:3', null)]
      .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
    expect(merged.map((c) => c.key)).toEqual(['tg:2', 'wa:1', 'ig:3'])
  })
})
