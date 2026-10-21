import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { checkAgentHealth, isAgentBridgeEnabled } from '@/lib/albra-agent-bridge'

/**
 * GET /api/agent/status
 * Devuelve el estado de conectividad y salud del AGENTE GENERAL (Python / FastAPI).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAuth(req)
    const force = req.nextUrl.searchParams.get('refresh') === 'true'
    const health = await checkAgentHealth(force)

    return json({
      enabled: isAgentBridgeEnabled(),
      bridge: 'albra-agent-seed-v1.0',
      agent: health,
    })
  })
}
