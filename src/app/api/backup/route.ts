import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'settings', 'read')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  try {
    // Export all user data as JSON
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, company: true, phone: true, role: true, createdAt: true },
    })

    const clients = await db.client.findMany({
      where: { userId },
      include: {
        preferences: true,
        serviceHistory: true,
      },
    })

    const pipelineStages = await db.pipelineStage.findMany({ where: { userId } })

    const opportunities = await db.opportunity.findMany({
      where: { userId },
      include: { progressNotes: true },
    })

    const quotes = await db.quote.findMany({
      where: { userId },
      include: { items: true },
    })

    const reservations = await db.reservation.findMany({ where: { userId } })
    const transactions = await db.transaction.findMany({ where: { userId } })
    const automations = await db.automation.findMany({ where: { userId } })
    const services = await db.service.findMany({ where: { userId } })
    const chatLogs = await db.chatLog.findMany({ where: { userId } })
    const memories = await db.memory.findMany({ where: { userId } })
    const notifications = await db.notification.findMany({ where: { userId } })
    const templates = await db.messageTemplate.findMany({ where: { userId } })
    const customFields = await db.customField.findMany({
      where: { userId },
      include: { values: true },
    })
    const activityLog = await db.activityLog.findMany({ where: { userId } })

    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      app: 'CRM ALBRA',
      user,
      data: {
        clients,
        pipelineStages,
        opportunities,
        quotes,
        reservations,
        transactions,
        automations,
        services,
        chatLogs,
        memories,
        notifications,
        templates,
        customFields,
        activityLog,
      },
    }

    const json = JSON.stringify(backup, null, 2)

    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="crm-albra-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  } catch (error) {
    console.error('Backup export error:', error)
    return NextResponse.json({ error: 'Error al exportar backup' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'settings', 'update')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  try {
    const body = await request.json()

    if (!body.version || !body.data) {
      return NextResponse.json({ error: 'Formato de backup inválido' }, { status: 400 })
    }

    let imported = 0
    let skipped = 0
    const data = body.data

    // Import clients
    if (data.clients && Array.isArray(data.clients)) {
      for (const client of data.clients) {
        try {
          const { preferences, serviceHistory, ...clientData } = client
          await db.client.upsert({
            where: { id: client.id },
            update: { ...clientData, userId },
            create: { ...clientData, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import pipeline stages
    if (data.pipelineStages && Array.isArray(data.pipelineStages)) {
      for (const stage of data.pipelineStages) {
        try {
          await db.pipelineStage.upsert({
            where: { id: stage.id },
            update: { ...stage, userId },
            create: { ...stage, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import services
    if (data.services && Array.isArray(data.services)) {
      for (const service of data.services) {
        try {
          await db.service.upsert({
            where: { id: service.id },
            update: { ...service, userId },
            create: { ...service, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import opportunities
    if (data.opportunities && Array.isArray(data.opportunities)) {
      for (const opp of data.opportunities) {
        try {
          const { progressNotes, ...oppData } = opp
          await db.opportunity.upsert({
            where: { id: opp.id },
            update: { ...oppData, userId },
            create: { ...oppData, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import quotes
    if (data.quotes && Array.isArray(data.quotes)) {
      for (const quote of data.quotes) {
        try {
          const { items, ...quoteData } = quote
          await db.quote.upsert({
            where: { id: quote.id },
            update: { ...quoteData, userId },
            create: { ...quoteData, userId },
          })
          // Import quote items
          if (items && Array.isArray(items)) {
            for (const item of items) {
              await db.quoteItem.upsert({
                where: { id: item.id },
                update: item,
                create: item,
              })
            }
          }
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import reservations
    if (data.reservations && Array.isArray(data.reservations)) {
      for (const res of data.reservations) {
        try {
          await db.reservation.upsert({
            where: { id: res.id },
            update: { ...res, userId },
            create: { ...res, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import transactions
    if (data.transactions && Array.isArray(data.transactions)) {
      for (const tx of data.transactions) {
        try {
          await db.transaction.upsert({
            where: { id: tx.id },
            update: { ...tx, userId },
            create: { ...tx, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import automations
    if (data.automations && Array.isArray(data.automations)) {
      for (const auto of data.automations) {
        try {
          await db.automation.upsert({
            where: { id: auto.id },
            update: { ...auto, userId },
            create: { ...auto, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import memories
    if (data.memories && Array.isArray(data.memories)) {
      for (const mem of data.memories) {
        try {
          await db.memory.upsert({
            where: { id: mem.id },
            update: { ...mem, userId },
            create: { ...mem, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    // Import templates
    if (data.templates && Array.isArray(data.templates)) {
      for (const tpl of data.templates) {
        try {
          await db.messageTemplate.upsert({
            where: { id: tpl.id },
            update: { ...tpl, userId },
            create: { ...tpl, userId },
          })
          imported++
        } catch {
          skipped++
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Backup restaurado: ${imported} registros importados, ${skipped} omitidos`,
      imported,
      skipped,
    })
  } catch (error) {
    console.error('Backup import error:', error)
    return NextResponse.json({ error: 'Error al importar backup' }, { status: 500 })
  }
}
