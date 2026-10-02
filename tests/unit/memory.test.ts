import { describe, expect, it } from 'vitest'
import {
  cosine,
  parseVector,
  formatRecallBlock,
  formatStyleLessons,
  MAX_MEMORY_TEXT,
} from '@/lib/memory'

/**
 * Tests unitarios de las funciones puras de la memoria vectorial (Fase 5):
 * similitud coseno, parseo tolerante de vectores guardados y formateo de los
 * bloques que se inyectan en los prompts del agente. Sin BD ni red.
 */

const baseDate = new Date('2026-01-15T10:00:00.000Z')

describe('cosine', () => {
  it('devuelve 1 para vectores idénticos y 0 para ortogonales', () => {
    expect(cosine([1, 0, 2], [1, 0, 2])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('devuelve valores intermedios con signo correcto', () => {
    expect(cosine([1, 0], [1, 1])).toBeCloseTo(Math.SQRT1_2)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('devuelve 0 con dimensiones distintas o vectores vacíos/cero', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
    expect(cosine([], [])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('parseVector', () => {
  it('parsea un JSON válido de floats', () => {
    expect(parseVector('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('devuelve null con basura, vacío o valores no finitos (tolerante)', () => {
    expect(parseVector(null)).toBeNull()
    expect(parseVector('')).toBeNull()
    expect(parseVector('no-json')).toBeNull()
    expect(parseVector('[]')).toBeNull()
    expect(parseVector('{"a":1}')).toBeNull()
    expect(parseVector('[1,"x",3]')).toBeNull()
  })
})

describe('formatRecallBlock', () => {
  it('formatea el bloque MEMORIA con canal, rol y fecha por fragmento', () => {
    const block = formatRecallBlock([
      { text: 'Quiero una puerta de madera', channel: 'whatsapp', role: 'incoming', embedding: null, createdAt: baseDate },
      { text: 'Claro, te cotizo', channel: 'whatsapp', role: 'outgoing', embedding: null, createdAt: baseDate },
    ])
    expect(block).toContain('MEMORIA DE CONVERSACIONES ANTERIORES')
    expect(block).toContain('- (whatsapp, cliente, 2026-01-15) Quiero una puerta de madera')
    expect(block).toContain('- (whatsapp, negocio, 2026-01-15) Claro, te cotizo')
  })

  it('devuelve "" con cero fragmentos (no ensucia el prompt)', () => {
    expect(formatRecallBlock([])).toBe('')
  })
})

describe('formatStyleLessons', () => {
  it('formatea los pares ANTES/AHORA', () => {
    const block = formatStyleLessons([
      { original: 'Hola, ¿quieres cotizar?', final: 'Buenos días Ana, ¿te ayudo con una cotización?' },
    ])
    expect(block).toContain('LECCIONES DE ESTILO DEL VENDEDOR')
    expect(block).toContain('- ANTES: Hola, ¿quieres cotizar?')
    expect(block).toContain('AHORA (estilo del vendedor): Buenos días Ana')
  })

  it('devuelve "" sin lecciones', () => {
    expect(formatStyleLessons([])).toBe('')
  })
})

describe('constantes de la memoria', () => {
  it('MAX_MEMORY_TEXT recorta textos largos a un límite razonable', () => {
    expect(MAX_MEMORY_TEXT).toBeGreaterThan(500)
    expect(MAX_MEMORY_TEXT).toBeLessThanOrEqual(4000)
  })
})
