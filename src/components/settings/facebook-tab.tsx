'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Save,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Send,
  RefreshCw,
  Facebook,
} from 'lucide-react'
import { toast } from 'sonner'

interface FbConfig {
  pageId: string
  pageToken: string // enmascarado
  webhookVerifyToken: string
  hasAppSecret: boolean
  isActive: boolean
  hasPageToken: boolean
}

interface FbStatus {
  configured: boolean
  config: FbConfig | null
}

export function FacebookTab() {
  const [status, setStatus] = useState<FbStatus>({ configured: false, config: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // Form fields
  const [pageId, setPageId] = useState('')
  const [pageToken, setPageToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [appSecret, setAppSecret] = useState('')

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getFacebookConfig()
      setStatus(data)
      if (data.config) {
        setPageId(data.config.pageId || '')
        setPageToken(data.config.pageToken || '')
        setWebhookVerifyToken(data.config.webhookVerifyToken || '')
      }
    } catch {
      // Sin config aún
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.saveFacebookConfig({
        pageId,
        pageToken: pageToken.startsWith('••••') ? undefined : pageToken,
        webhookVerifyToken,
        appSecret: appSecret || undefined,
      })
      toast.success('Configuración de Facebook guardada')
      await loadConfig()
      setAppSecret('')
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar Facebook?')) return
    try {
      await api.disconnectFacebook()
      toast.success('Facebook desconectado')
      await loadConfig()
      setPageId('')
      setPageToken('')
      setWebhookVerifyToken('')
    } catch {
      toast.error('Error al desconectar')
    }
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/facebook/webhook`
      : '/api/facebook/webhook'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center">
                <Facebook className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Facebook Messenger
                  {status.config?.isActive && (
                    <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Recibe y responde los mensajes de tu Página de Facebook con auto-respuesta IA
                </CardDescription>
              </div>
            </div>
            {status.configured && (
              <Button variant="outline" size="sm" onClick={() => void loadConfig()}>
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Refrescar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fb-page-id">Page ID</Label>
            <Input
              id="fb-page-id"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="1000..."
            />
            <p className="text-xs text-slate-500">
              ID de tu Página de Facebook. Lo obtienes en Meta Business Suite &gt; Configuración &gt; Página, o vía Graph API /me.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-page-token">Page Access Token</Label>
            <div className="flex gap-2">
              <Input
                id="fb-page-token"
                type={showToken ? 'text' : 'password'}
                value={pageToken}
                onChange={(e) => setPageToken(e.target.value)}
                placeholder={status.config?.hasPageToken ? '••••••••' + (pageToken || '') : 'EAAB...'}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowToken((s) => !s)}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Token de la Página (Graph API). Se almacena cifrado con AES-256-GCM.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-verify-token">Webhook Verify Token</Label>
            <Input
              id="fb-verify-token"
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="crm_albra_fb_verify_..."
            />
            <p className="text-xs text-slate-500">
              Token que configuraste en Meta Developers &gt; Webhooks &gt; Verify Token.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-app-secret">App Secret (HMAC)</Label>
            <Input
              id="fb-app-secret"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={status.config?.hasAppSecret ? '•••••••• (configurado)' : 'App Secret de Meta'}
            />
            <p className="text-xs text-slate-500">
              App Secret de tu app de Meta (el mismo de Instagram). Se usa para verificar la firma
              HMAC del webhook. Se almacena cifrado. Déjalo vacío para mantener el actual.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Send className="w-3 h-3" />
              <span className="font-semibold">Webhook URL</span>
            </div>
            <code className="text-xs text-slate-800 break-all">{webhookUrl}</code>
            <p className="text-xs text-slate-500 mt-1">
              Configura esta URL en Meta Developers → Webhooks → Page → Subscribe (campo <code className="bg-slate-100 px-1 py-0.5 rounded">messages</code>).
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !pageId || !webhookVerifyToken}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {status.configured ? 'Guardar cambios' : 'Conectar Facebook'}
            </Button>
            {status.configured && (
              <Button variant="outline" onClick={handleDisconnect}>
                <Trash2 className="w-4 h-4 mr-2" />
                Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cómo configurar Facebook Messenger</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-slate-600 space-y-2">
          <p>
            <strong>1.</strong> Usa la misma app de Meta de Instagram (
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 hover:underline"
            >
              Meta Developers
            </a>
            ) y añade el producto <strong>Messenger</strong>.
          </p>
          <p>
            <strong>2.</strong> Vincula tu Página de Facebook a la app (Messenger &gt; Settings &gt; Access Tokens) y copia el <strong>Page Access Token</strong>.
          </p>
          <p>
            <strong>3.</strong> En Webhooks, suscribe la Página con la URL del webhook, el Verify Token y el campo{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">messages</code>.
          </p>
          <p>
            <strong>4.</strong> Pega el Page ID, el Page Token y el App Secret aquí. Los mensajes de la Página entran a la Bandeja junto con WhatsApp, Telegram e Instagram.
          </p>
          <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded border border-amber-200">
            <strong>Importante:</strong> la app debe estar en modo <em>live</em> y con permisos{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">pages_messaging, pages_manage_metadata</code>{' '}
            para enviar y recibir mensajes reales.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
