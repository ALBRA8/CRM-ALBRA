import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { checkAgentHealth, isAgentBridgeEnabled } from '@/lib/albra-agent-bridge'

/**
 * GET /api/agent-general/status
 * Devuelve el estado de conectividad y salud del AGENTE GENERAL (Python / FastAPI).
 * NOTA: vive FUERA de src/app/api/agent (directorio vetado por GATE-B del chaleco:
 * era la ruta del agente propietario eliminado; esto es un puente opcional con el
 * futuro host, no un agente sustituto).
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
