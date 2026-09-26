import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { GET as knowledgeGET, POST as knowledgePOST } from '@/app/api/knowledge/route'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * API de la base de conocimiento (/api/knowledge, handler real):
 * crear, listar, filtrar por categoría, validar y aislar por organización.
 */

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: string
  isActive: boolean
}

describe('POST /api/knowledge', () => {
  it('crea una entrada activa (201) y persiste en la BD', async () => {
    const res = await knowledgePOST(
      req('/api/knowledge', {
        method: 'POST',
        token: tokenA(),
        body: { title: 'Política de devoluciones', content: 'Se aceptan devoluciones dentro de 30 días.', category: 'politicas' },
      })
    )
    expect(res.status).toBe(201)
    const entry = ((await jsonBody(res)).knowledge as KnowledgeEntry)
    expect(entry.title).toBe('Política de devoluciones')
    expect(entry.category).toBe('politicas')
    expect(entry.isActive).toBe(true)

    const inDb = await db.knowledge.findUnique({ where: { id: entry.id } })
    expect(inDb?.organizationId).toBe(FIX.orgA.id)
    expect(inDb?.content).toContain('30 días')
  })

  it('recorta título (120) y contenido (8000) sin romper', async () => {
    const res = await knowledgePOST(
      req('/api/knowledge', {
        method: 'POST',
        token: tokenA(),
        body: { title: 'T'.repeat(300), content: 'C'.repeat(9000) },
      })
    )
    expect(res.status).toBe(201)
    const entry = ((await jsonBody(res)).knowledge as KnowledgeEntry)
    expect(entry.title.length).toBe(120)
    const inDb = await db.knowledge.findUnique({ where: { id: entry.id } })
    expect(inDb?.content.length).toBe(8000)
  })

  it('400 sin título o sin contenido', async () => {
    const resNoTitle = await knowledgePOST(
      req('/api/knowledge', { method: 'POST', token: tokenA(), body: { content: 'algo' } })
    )
    expect(resNoTitle.status).toBe(400)
    const resNoContent = await knowledgePOST(
      req('/api/knowledge', { method: 'POST', token: tokenA(), body: { title: 'algo' } })
    )
    expect(resNoContent.status).toBe(400)
  })

  it('400 con categoría fuera del catálogo permitido', async () => {
    const res = await knowledgePOST(
      req('/api/knowledge', {
        method: 'POST',
        token: tokenA(),
        body: { title: 'X', content: 'Y', category: 'recetas' },
      })
    )
    expect(res.status).toBe(400)
    const body = await jsonBody(res)
    expect(String(body.error)).toContain('category')
  })
})

describe('GET /api/knowledge', () => {
  it('lista las entradas de la organización (activas primero)', async () => {
    const res = await knowledgeGET(req('/api/knowledge', { token: tokenA() }))
    expect(res.status).toBe(200)
    const entries = ((await jsonBody(res)).knowledge as KnowledgeEntry[])
    expect(entries.length).toBeGreaterThanOrEqual(3)
    const titles = entries.map((e) => e.title)
    expect(titles).toContain('Catálogo 2025')
    expect(titles).toContain('Horario FAQ')
    expect(titles).toContain('Nota interna borrador')
    const firstActiveIdx = entries.findIndex((e) => !e.isActive)
    const lastActiveIdx = entries.map((e) => e.isActive).lastIndexOf(true)
    if (firstActiveIdx !== -1 && lastActiveIdx !== -1) {
      expect(lastActiveIdx).toBeLessThan(firstActiveIdx)
    }
  })

  it('filtra por ?category=', async () => {
    const res = await knowledgeGET(req('/api/knowledge?category=faq', { token: tokenA() }))
    const entries = ((await jsonBody(res)).knowledge as KnowledgeEntry[])
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.category === 'faq')).toBe(true)
  })

  it('aislamiento multi-tenant: org B solo ve sus entradas', async () => {
    const res = await knowledgeGET(req('/api/knowledge', { token: tokenB() }))
    const entries = ((await jsonBody(res)).knowledge as KnowledgeEntry[])
    expect(entries.map((e) => e.title)).toContain('FAQ Org B')
    expect(entries.map((e) => e.title)).not.toContain('Catálogo 2025')
  })
})
