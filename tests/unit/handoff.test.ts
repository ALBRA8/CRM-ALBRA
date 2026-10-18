import { describe, expect, it } from 'vitest'
import { parseHandoffKeywords, matchesHandoffKeyword, createHandoffKeywordLoader, parseAiToggleCommand, normalizeCommandToken, createAssistantNameLoader, parseHandoffNotifyPhones, normalizeNotifyPhone, createHandoffNotifyPhonesLoader } from '@/whatsapp-daemon/handoff.mjs'

/**
 * Handoff a humano (Fase 5) — unit del módulo puro del daemon Baileys.
 * El daemon importa este archivo directamente (ESM .mjs), así que los tests
 * ejercitan EXACTAMENTE el código que corre en producción.
 * Escenarios: parseo tolerante de NichoConfig.handoffKeywords, matching
 * case-insensitive por inclusión (mismo criterio que channel-autoresponder.ts) y
 * loader con caché TTL + fail-open ante errores de DB.
 */

describe('parseHandoffKeywords', () => {
  it('parsea un JSON array válido y limpia espacios', () => {
    expect(parseHandoffKeywords('["hablar con un humano", " agente humano "]')).toEqual([
      'hablar con un humano',
      'agente humano',
    ])
  })

  it('descarta elementos no-string y strings vacíos', () => {
    expect(parseHandoffKeywords('["humano", 42, null, "", "asesor"]')).toEqual(['humano', 'asesor'])
  })

  it('devuelve [] con JSON inválido (fail-closed tolerante)', () => {
    expect(parseHandoffKeywords('no-es-json')).toEqual([])
  })

  it('devuelve [] si el JSON no es un array', () => {
    expect(parseHandoffKeywords('{"kw": "humano"}')).toEqual([])
  })

  it('devuelve [] con null/undefined/vacío', () => {
    expect(parseHandoffKeywords(null as unknown as string)).toEqual([])
    expect(parseHandoffKeywords(undefined as unknown as string)).toEqual([])
    expect(parseHandoffKeywords('')).toEqual([])
  })
})

describe('matchesHandoffKeyword', () => {
  const keywords = ['hablar con un humano', 'Asesor', 'URGENTE']

  it('detecta la keyword (case-insensitive, por inclusión)', () => {
    expect(matchesHandoffKeyword('Hola, quiero hablar con un humano por favor', keywords)).toBe(true)
    expect(matchesHandoffKeyword('NECESITO UN ASESOR ya', keywords)).toBe(true)
  })

  it('detecta aunque el texto tenga mayúsculas/minúsculas mezcladas', () => {
    expect(matchesHandoffKeyword('Es Urgente!!', keywords)).toBe(true)
  })

  it('no dispara con texto que no contiene ninguna keyword', () => {
    expect(matchesHandoffKeyword('¿Tienen camisas azules talla M?', keywords)).toBe(false)
  })

  it('no dispara con texto vacío o inválido', () => {
    expect(matchesHandoffKeyword('', keywords)).toBe(false)
    expect(matchesHandoffKeyword(null as unknown as string, keywords)).toBe(false)
  })

  it('no dispara con lista de keywords vacía o inválida', () => {
    expect(matchesHandoffKeyword('quiero hablar con un humano', [])).toBe(false)
    expect(matchesHandoffKeyword('quiero hablar con un humano', null as unknown as string[])).toBe(false)
  })

  it('funciona con transcripciones de voz (texto largo con la keyword en medio)', () => {
    const transcription =
      'Hola, buenos días, escuché de ustedes por un amigo y me interesa un visto bueno... pero mejor quiero hablar con un humano directamente'
    expect(matchesHandoffKeyword(transcription, ['hablar con un humano'])).toBe(true)
  })
})

describe('parseAiToggleCommand (solo asesor humano desde el teléfono del negocio)', () => {
  it('reconoce /ia on y /ia off en cualquier combinación de mayúsculas', () => {
    expect(parseAiToggleCommand('/ia on')).toBe('on')
    expect(parseAiToggleCommand('/ia off')).toBe('off')
    expect(parseAiToggleCommand('/IA ON')).toBe('on')
    expect(parseAiToggleCommand('/IA OFF')).toBe('off')
  })

  it('acepta el comando dentro de un mensaje natural de cierre (el cliente ve texto del asesor)', () => {
    expect(parseAiToggleCommand('¡Listo! Con esto te vuelve a atender mi asistente /ia on')).toBe('on')
    expect(parseAiToggleCommand('Me retiro un momento, /ia off')).toBe('off')
  })

  it('tolera espacios irregulares entre /ia y on|off', () => {
    expect(parseAiToggleCommand('/ia   on')).toBe('on')
    expect(parseAiToggleCommand('/iaoff')).toBe('off')
  })

  it('devuelve null con texto que NO es comando (no confunde al cliente)', () => {
    // CRÍTICO: el cliente escribió exactamente esto — jamás debe togglear la IA
    expect(parseAiToggleCommand('Ya puedes activar la ia')).toBeNull()
    expect(parseAiToggleCommand('quiero que actives la ia')).toBeNull()
    expect(parseAiToggleCommand('hola')).toBeNull()
    expect(parseAiToggleCommand('')).toBeNull()
    expect(parseAiToggleCommand(null as unknown as string)).toBeNull()
  })

  it('devuelve null con la barra sola o comando incompleto', () => {
    expect(parseAiToggleCommand('/ia')).toBeNull()
    expect(parseAiToggleCommand('/ia activar')).toBeNull()
  })

  it('acepta el NOMBRE configurado del asistente como token (/luna on)', () => {
    expect(parseAiToggleCommand('/luna on', ['Luna'])).toBe('on')
    expect(parseAiToggleCommand('/Luna OFF', ['Luna'])).toBe('off')
    expect(parseAiToggleCommand('¡Listo! Te atiende Luna /luna on', ['Luna'])).toBe('on')
    // El fallback /ia sigue funcionando con nombre configurado
    expect(parseAiToggleCommand('/ia on', ['Luna'])).toBe('on')
  })

  it('el nombre ignora acentos y mayúsculas (María → /maria on)', () => {
    expect(parseAiToggleCommand('/maria on', ['María'])).toBe('on')
    expect(parseAiToggleCommand('/MARÍA off', ['maria'])).toBe('off')
  })

  it('con nombre compuesto usa la primera palabra (María Luz → /maria)', () => {
    expect(parseAiToggleCommand('/maria on', ['María Luz'])).toBe('on')
    expect(parseAiToggleCommand('/luz on', ['María Luz'])).toBeNull()
  })

  it('no matchea nombres distintos al configurado', () => {
    expect(parseAiToggleCommand('/carla on', ['Luna'])).toBeNull()
    expect(parseAiToggleCommand('/carla on', [])).toBeNull()
  })

  it('null como nombre extra → solo /ia funciona', () => {
    expect(parseAiToggleCommand('/luna on', [null as unknown as string])).toBeNull()
    expect(parseAiToggleCommand('/ia on', [null as unknown as string])).toBe('on')
  })
})

describe('normalizeCommandToken', () => {
  it('normaliza a minúsculas sin acentos', () => {
    expect(normalizeCommandToken('Luna')).toBe('luna')
    expect(normalizeCommandToken('MARÍA')).toBe('maria')
    expect(normalizeCommandToken('José')).toBe('jose')
  })

  it('usa solo el primer bloque alfanumérico', () => {
    expect(normalizeCommandToken('María Luz')).toBe('maria')
    expect(normalizeCommandToken('  Sol-1  ')).toBe('sol')
  })

  it('devuelve null con entradas inválidas', () => {
    expect(normalizeCommandToken('')).toBeNull()
    expect(normalizeCommandToken('   ')).toBeNull()
    expect(normalizeCommandToken(null as unknown as string)).toBeNull()
    expect(normalizeCommandToken(undefined as unknown as string)).toBeNull()
  })
})

describe('createAssistantNameLoader', () => {
  it('lee el nombre del asistente de NichoConfig', () => {
    const db = {
      prepare: () => ({
        get: () => ({ assistantName: 'Luna' }),
      }),
    }
    const load = createAssistantNameLoader(db)
    expect(load('org-a')).toBe('Luna')
  })

  it('devuelve null si no está configurado o es vacío', () => {
    const db = {
      prepare: () => ({
        get: () => ({ assistantName: '   ' }),
      }),
    }
    expect(createAssistantNameLoader(db)('org-a')).toBeNull()
  })

  it('cachea por org y respeta TTL', () => {
    let queries = 0
    const db = {
      prepare: () => ({
        get: () => {
          queries++
          return { assistantName: 'Luna' }
        },
      }),
    }
    const load = createAssistantNameLoader(db)
    load('org-a')
    load('org-a')
    expect(queries).toBe(1)
    // TTL 0 → cada llamada reconsulta (instancia nueva, mismo contador)
    const load2 = createAssistantNameLoader(db, { ttlMs: 0 })
    load2('org-b')
    load2('org-b')
    expect(queries).toBe(3)
  })

  it('fail-open: error de DB → null (queda /ia on|off)', () => {
    const db = {
      prepare: () => {
        throw new Error('db rota')
      },
    }
    expect(createAssistantNameLoader(db)('org-a')).toBeNull()
  })
})

describe('createHandoffKeywordLoader', () => {
  it('lee keywords de NichoConfig por organización', () => {
    const db = {
      prepare: () => ({
        get: (orgId: string) =>
          orgId === 'org-a' ? { handoffKeywords: '["hablar con un humano"]' } : undefined,
      }),
    }
    const load = createHandoffKeywordLoader(db)
    expect(load('org-a')).toEqual(['hablar con un humano'])
    expect(load('org-b')).toEqual([])
  })

  it('cachea por org dentro del TTL (una sola query)', () => {
    let queries = 0
    const db = {
      prepare: () => ({
        get: () => {
          queries++
          return { handoffKeywords: '["asesor"]' }
        },
      }),
    }
    const load = createHandoffKeywordLoader(db)
    load('org-x')
    load('org-x')
    load('org-x')
    expect(queries).toBe(1)
    // Org distinta → query propia
    load('org-y')
    expect(queries).toBe(2)
  })

  it('fail-open: error de DB → [] y la IA sigue respondiendo', () => {
    const db = {
      prepare: () => {
        throw new Error('db rota')
      },
    }
    const load = createHandoffKeywordLoader(db)
    expect(load('org-a')).toEqual([])
  })

  it('db null (daemon sin BD) → [] sin lanzar', () => {
    const load = createHandoffKeywordLoader(null)
    expect(load('org-a')).toEqual([])
  })

  it('respeta TTL: tras expirar vuelve a consultar', () => {
    let queries = 0
    const db = {
      prepare: () => ({
        get: () => {
          queries++
          return { handoffKeywords: '["asesor"]' }
        },
      }),
    }
    const load = createHandoffKeywordLoader(db, { ttlMs: 0 })
    load('org-a')
    load('org-a')
    expect(queries).toBe(2)
  })
})

describe('parseHandoffNotifyPhones', () => {
  it('acepta JSON array', () => {
    expect(parseHandoffNotifyPhones('["573001234567","573159876543"]')).toEqual(['573001234567', '573159876543'])
  })

  it('acepta texto plano con saltos de línea (formato del textarea de Settings)', () => {
    expect(parseHandoffNotifyPhones('573001234567\n573 159 876 543')).toEqual(['573001234567', '573 159 876 543'])
  })

  it('acepta separadores coma y punto y coma, recorta espacios y descarta vacíos', () => {
    expect(parseHandoffNotifyPhones('573001234567, 573159876543;; +573204445566')).toEqual([
      '573001234567',
      '573159876543',
      '+573204445566',
    ])
  })

  it('deduplica por dígitos y limita a 10 teléfonos', () => {
    const dup = parseHandoffNotifyPhones('["573001234567","+57 300 123 4567"]')
    expect(dup).toEqual(['573001234567'])
    const many = Array.from({ length: 15 }, (_, i) => `"5730000000${i}"`).join(',')
    expect(parseHandoffNotifyPhones(`[${many}]`).length).toBe(10)
  })

  it('entrada inválida → [] (números, objetos, vacío)', () => {
    expect(parseHandoffNotifyPhones(null)).toEqual([])
    expect(parseHandoffNotifyPhones('')).toEqual([])
    expect(parseHandoffNotifyPhones('   ')).toEqual([])
    expect(parseHandoffNotifyPhones('12345')).toEqual([])
    expect(parseHandoffNotifyPhones('{"tel":"573001234567"}')).toEqual([])
  })
})

describe('normalizeNotifyPhone', () => {
  it('deja intacto un número internacional completo', () => {
    expect(normalizeNotifyPhone('573001234567')).toBe('573001234567')
    expect(normalizeNotifyPhone('+57 300 123 4567')).toBe('573001234567')
  })

  it('un nacional de 10 dígitos hereda el código de país del teléfono del negocio', () => {
    expect(normalizeNotifyPhone('3001234567', '573163301286')).toBe('573001234567')
  })

  it('sin teléfono de referencia deja el nacional tal cual', () => {
    expect(normalizeNotifyPhone('3001234567')).toBe('3001234567')
  })

  it('sin dígitos → null', () => {
    expect(normalizeNotifyPhone('abc')).toBe(null)
    expect(normalizeNotifyPhone('')).toBe(null)
    expect(normalizeNotifyPhone(null)).toBe(null)
  })
})

describe('createHandoffNotifyPhonesLoader', () => {
  it('carga, normaliza y cachea por org', () => {
    let queries = 0
    const db = {
      prepare: () => ({
        get: () => {
          queries++
          return { handoffNotifyPhones: '["3001234567","573159876543"]' }
        },
      }),
    }
    const load = createHandoffNotifyPhonesLoader(db, { getBusinessPhone: () => '573163301286' })
    expect(load('org-a')).toEqual(['573001234567', '573159876543'])
    expect(load('org-a')).toEqual(['573001234567', '573159876543'])
    expect(queries).toBe(1)
  })

  it('sin config → [] y fail-open con DB rota', () => {
    const empty = { prepare: () => ({ get: () => null }) }
    expect(createHandoffNotifyPhonesLoader(empty)('org-a')).toEqual([])
    const broken = { prepare: () => { throw new Error('db rota') } }
    expect(createHandoffNotifyPhonesLoader(broken)('org-a')).toEqual([])
    expect(createHandoffNotifyPhonesLoader(null)('org-a')).toEqual([])
  })

  it('getBusinessPhone puede aún no estar disponible (callback → null)', () => {
    const db = { prepare: () => ({ get: () => ({ handoffNotifyPhones: '["573001234567"]' }) }) }
    const load = createHandoffNotifyPhonesLoader(db, { getBusinessPhone: () => null })
    expect(load('org-a')).toEqual(['573001234567'])
  })
})
