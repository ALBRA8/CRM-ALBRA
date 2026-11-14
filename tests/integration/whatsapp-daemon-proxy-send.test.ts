import { describe, expect, it, vi } from 'vitest'
import { POST as daemonProxyPOST } from '@/app/api/whatsapp/daemon-proxy/route'
import { jsonBody, req, tokenA } from '../helpers'

describe('POST /api/whatsapp/daemon-proxy — legacy send guard', () => {
  it('rechaza /send sin contactar al daemon', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const res = await daemonProxyPOST(req('/api/whatsapp/daemon-proxy', {
        method: 'POST',
        token: tokenA(),
        body: { path: '/send', to: '+573001110000', text: 'No debe salir' },
      }))
      expect(res.status).toBe(409)
      expect(await jsonBody(res)).toMatchObject({ code: 'LEGACY_SEND_DISABLED' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
