/**
 * Renombra las etapas del pipeline al embudo profesional:
 * Prospección → Calificación → Oferta → Seguimiento → Cierre Ganado (+ Cierre Perdido).
 *
 * - Preserva los IDs de las etapas existentes (rename in place) para que las
 *   oportunidades no pierdan su stageId.
 * - Inserta etapas faltantes (p. ej. "Seguimiento" o "Cierre Perdido").
 * - Normaliza orden/probabilidad/color/flags de las etapas canónicas.
 * - Actualiza la automatización demo que condiciona sobre "Cotizado" → "Oferta".
 * - Re-sincroniza opportunity.status con los flags de su etapa.
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const CANONICAL = [
  { name: 'Prospección', probability: 0.1, color: '#64748b', isWon: false, isLost: false },
  { name: 'Calificación', probability: 0.3, color: '#0ea5e9', isWon: false, isLost: false },
  { name: 'Oferta', probability: 0.5, color: '#f97316', isWon: false, isLost: false },
  { name: 'Seguimiento', probability: 0.75, color: '#f59e0b', isWon: false, isLost: false },
  { name: 'Cierre Ganado', probability: 1, color: '#10b981', isWon: true, isLost: false },
  { name: 'Cierre Perdido', probability: 0, color: '#ef4444', isWon: false, isLost: true },
]

// Mapeo de nombres antiguos → nuevos (rename in place, preserva ID)
const RENAME: Record<string, string> = {
  Nuevo: 'Prospección',
  Contactado: 'Calificación',
  Cotizado: 'Oferta',
  Ganado: 'Seguimiento',
  Perdido: 'Cierre Ganado',
}

async function main(): Promise<void> {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  console.log(`Organizaciones: ${orgs.length}`)

  for (const org of orgs) {
    const stages = await db.pipelineStage.findMany({ where: { organizationId: org.id } })
    const byName = new Map(stages.map((s) => [s.name, s]))
    const usedIds = new Set<string>()
    let renamed = 0
    let inserted = 0

    // 1) Renombrar etapas antiguas → nuevas (in place)
    for (const stage of stages) {
      const target = RENAME[stage.name]
      if (target && !byName.has(target)) {
        await db.pipelineStage.update({ where: { id: stage.id }, data: { name: target } })
        byName.delete(stage.name)
        const updated = { ...stage, name: target }
        byName.set(target, updated)
        usedIds.add(stage.id)
        renamed++
        console.log(`  [${org.name}] "${stage.name}" → "${target}"`)
      }
    }

    // 2) Asegurar las 6 etapas canónicas con orden/props correctos
    for (let i = 0; i < CANONICAL.length; i++) {
      const c = CANONICAL[i]
      const existing = byName.get(c.name)
      if (existing) {
        await db.pipelineStage.update({
          where: { id: existing.id },
          data: {
            order: i + 1,
            probability: c.probability,
            color: c.color,
            isWon: c.isWon,
            isLost: c.isLost,
          },
        })
        usedIds.add(existing.id)
      } else {
        await db.pipelineStage.create({
          data: {
            organizationId: org.id,
            name: c.name,
            order: i + 1,
            probability: c.probability,
            color: c.color,
            isWon: c.isWon,
            isLost: c.isLost,
          },
        })
        inserted++
        console.log(`  [${org.name}] + etapa creada: "${c.name}"`)
      }
    }

    // 3) Re-sincronizar status de oportunidades con los flags de su etapa
    const opps = await db.opportunity.findMany({
      where: { organizationId: org.id },
      select: { id: true, status: true, stageId: true, stage: { select: { isWon: true, isLost: true } } },
    })
    let synced = 0
    for (const o of opps) {
      const isWonStage = o.stage?.isWon ?? false
      const isLostStage = o.stage?.isLost ?? false
      const expected = isWonStage ? 'won' : isLostStage ? 'lost' : 'open'
      if (o.status !== expected) {
        await db.opportunity.update({ where: { id: o.id }, data: { status: expected } })
        synced++
      }
    }

    // 4) Actualizar automatización demo que referencia "Cotizado"
    const autos = await db.automation.findMany({
      where: { organizationId: org.id, conditions: { contains: 'Cotizado' } },
    })
    let autosFixed = 0
    for (const a of autos) {
      const conditions = (a.conditions ?? '').split('Cotizado').join('Oferta')
      const actions = (a.actions ?? '').split('Cotizado').join('Oferta')
      await db.automation.update({
        where: { id: a.id },
        data: {
          conditions,
          actions,
          name: a.name.split('Cotizado').join('Oferta'),
          description: (a.description ?? '').split('Cotizado').join('Oferta'),
        },
      })
      autosFixed++
    }

    console.log(
      `  [${org.name}] renombradas=${renamed} insertadas=${inserted} opps re-sincronizadas=${synced} automatizaciones corregidas=${autosFixed}`
    )
  }

  // Resumen final
  console.log('\nEtapa final por organización:')
  for (const org of orgs) {
    const stages = await db.pipelineStage.findMany({
      where: { organizationId: org.id },
      orderBy: { order: 'asc' },
    })
    console.log(`  [${org.name}] ${stages.map((s) => `${s.order}.${s.name}${s.isWon ? ' ✓WON' : ''}${s.isLost ? ' ✗LOST' : ''}`).join(' | ')}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
