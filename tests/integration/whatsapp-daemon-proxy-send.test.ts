import { describe, expect, it, vi } from 'vitest'
import { POST as daemonProxyPOST } from '@/app/api/whatsapp/daemon-proxy/route'
import { jsonBody, req, tokenA } from '../helpers'

describe('POST /api/whatsapp/daemon-proxy — legacy send guard', () => {
  it('rechaza /send sin contactar al daemon', async () => {
    const fetchSpy = vi.fn(async (url: string | URL) => {
      expect(String(url)).toMatch(/\\/status$/)
      return new Response(JSON.stringify({ status: 'connected', orgLinked: true, linkedOrgId: 'org-a' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const res = await daemonProxyPOST(req('/api/whatsapp/daemon-proxy', {
        method: 'POST',
        token: tokenA(),
        body: { path: '/send', to: '+573001110000', text: 'No debe salir' },
      }))
      expect(res.status).toBe(409)
      expect(await jsonBody(res)).toMatchObject({ code: 'LEGACY_SEND_DISABLED' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
