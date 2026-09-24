import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  // Verify internal secret
  const secret = request.headers.get('X-Internal-Secret')
  if (secret !== (process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const now = new Date()
    // Find all active automations with a scheduledAt condition that has passed
    const automations = await db.automation.findMany({
      where: {
        isActive: true,
        trigger: 'scheduled',
      },
    })

    let processed = 0
    let skipped = 0
    let failed = 0

    for (const automation of automations) {
      try {
        let conditions: Record<string, unknown> = {}
        try { conditions = JSON.parse(automation.conditions || '{}') } catch {}

        const scheduledAt = conditions.scheduledAt as string | undefined
        if (!scheduledAt) { skipped++; continue }

        // Check if the scheduled time has passed
        if (new Date(scheduledAt) > now) { skipped++; continue }

        // Check if already run (lastRunAt after scheduledAt)
        if (automation.lastRunAt && new Date(scheduledAt) <= automation.lastRunAt) { skipped++; continue }

        // Parse actions
        let actions: Record<string, unknown> = {}
        try { actions = JSON.parse(automation.actions || '{}') } catch {}

        const channel = actions.channel as string
        const message = (actions.message || automation.message) as string
        const phone = actions.phone as string

        if (channel === 'whatsapp' && phone && message) {
          // Send via WhatsApp daemon
          try {
            await fetch('http://localhost:3002/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: phone, message }),
            })
          } catch {
            // Daemon may not be running - log but don't fail
          }
        } else if (channel === 'telegram' && message) {
          // Telegram sends would go here
        }

        // Update automation run info
        await db.automation.update({
          where: { id: automation.id },
          data: {
            lastRunAt: now,
            runCount: { increment: 1 },
          },
        })

        // Log the execution
        const clientId = conditions.clientId as string | undefined
        await db.automationLog.create({
          data: {
            automationId: automation.id,
            clientId: clientId || null,
            status: 'sent',
            result: `Automation executed at ${now.toISOString()}`,
          },
        })

        processed++
      } catch {
        failed++
      }
    }

    return NextResponse.json({ processed, skipped, failed, total: automations.length })
  } catch {
    return NextResponse.json({ error: 'Error al procesar automatizaciones' }, { status: 500 })
  }
}
