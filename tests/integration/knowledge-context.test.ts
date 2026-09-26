import { describe, expect, it } from 'vitest'
import { buildKnowledgeContext } from '@/lib/knowledge'
import { FIX } from '../helpers'

/**
 * Tests de buildKnowledgeContext (src/lib/knowledge.ts) contra la BD de prueba.
 * Verifica el bloque de contexto que se inyecta en los system prompts del
 * Agente IA (canales + Chat AI): solo entradas ACTIVAS de la organización.
 */

describe('buildKnowledgeContext', () => {
  it('devuelve el bloque CONOCIMIENTO DEL NEGOCIO con las entradas activas de la org', async () => {
    const ctx = await buildKnowledgeContext(FIX.orgA.id)
    expect(ctx.startsWith('\n\nCONOCIMIENTO DEL NEGOCIO')).toBe(true)
    // Etiqueta de categoría para entradas no-generales
    expect(ctx).toContain('[CATALOGO] Catálogo 2025:')
    expect(ctx).toContain('El Producto Estrella cuesta 50 USD')
    expect(ctx).toContain('[FAQ] Horario FAQ:')
    expect(ctx).toContain('Abrimos de 8 a 18 horas')
  })

  it('excluye las entradas inactivas', async () => {
    const ctx = await buildKnowledgeContext(FIX.orgA.id)
    expect(ctx).not.toContain('CONTENIDO INACTIVO NO DEBE APARECER')
    expect(ctx).not.toContain('Nota interna borrador')
  })

  it('aislamiento multi-tenant: el conocimiento de otra org no aparece', async () => {
    const ctxA = await buildKnowledgeContext(FIX.orgA.id)
    expect(ctxA).not.toContain('CONTENIDO EXCLUSIVO DE ORG B')

    const ctxB = await buildKnowledgeContext(FIX.orgB.id)
    expect(ctxB).toContain('CONTENIDO EXCLUSIVO DE ORG B')
    expect(ctxB).not.toContain('Producto Estrella')
  })

  it('devuelve string vacío para una org sin conocimiento (el prompt no se ensucia)', async () => {
    const ctx = await buildKnowledgeContext(FIX.orgC.id)
    expect(ctx).toBe('')
  })
})
