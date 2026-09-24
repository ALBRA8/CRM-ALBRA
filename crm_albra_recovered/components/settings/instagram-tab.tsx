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
  CheckCircle,
  XCircle,
  Instagram,
  Send,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

interface IgConfig {
  id?: string
  igAccountId: string
  accessToken: string // enmascarado
  webhookVerifyToken: string
  hasWebhookSecret: boolean
  isActive: boolean
  hasAccessToken: boolean
}

interface IgStatus {
  configured: boolean
  config: IgConfig | null
}

export function InstagramTab() {
  const [status, setStatus] = useState<IgStatus>({ configured: false, config: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // Form fields
  const [igAccountId, setIgAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getInstagramConfig()
      setStatus(data)
      if (data.config) {
        setIgAccountId(data.config.igAccountId || '')
        setAccessToken(data.config.accessToken || '')
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
      await api.saveInstagramConfig({
        igAccountId,
        accessToken: accessToken.startsWith('••••') ? undefined : accessToken,
        webhookVerifyToken,
        webhookSecret: webhookSecret || undefined,
      })
      toast.success('Configuración de Instagram guardada')
      await loadConfig()
      setWebhookSecret('')
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar Instagram?')) return
    try {
      await api.disconnectInstagram()
      toast.success('Instagram desconectado')
      await loadConfig()
      setIgAccountId('')
      setAccessToken('')
      setWebhookVerifyToken('')
    } catch {
      toast.error('Error al desconectar')
    }
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/instagram/webhook`
      : '/api/instagram/webhook'

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
              <div className="w-10 h-10 bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-500 rounded-lg flex items-center justify-center">
                <Instagram className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Instagram Direct Messages
                  {status.config?.isActive && (
                    <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Recibe y envía mensajes directos de Instagram con auto-respuesta IA
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
            <Label htmlFor="ig-account-id">Instagram Business Account ID</Label>
            <Input
              id="ig-account-id"
              value={igAccountId}
              onChange={(e) => setIgAccountId(e.target.value)}
              placeholder="1789..."
            />
            <p className="text-xs text-slate-500">
              ID de tu cuenta de Instagram Business. Lo obtienes en Meta Business Suite &gt;
              Instagram &gt; Configuración &gt; API.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-access-token">Access Token</Label>
            <div className="flex gap-2">
              <Input
                id="ig-access-token"
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={status.config?.hasAccessToken ? '••••••••' + (accessToken || '') : 'EAAG...'}
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
              Token permanente de la Graph API. Se almacena cifrado con AES-256-GCM.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-verify-token">Webhook Verify Token</Label>
            <Input
              id="ig-verify-token"
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="crm_albra_ig_verify_..."
            />
            <p className="text-xs text-slate-500">
              Token que configuraste en Meta Developers &gt; Webhooks &gt; Verify Token.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-webhook-secret">App Secret (HMAC)</Label>
            <Input
              id="ig-webhook-secret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={status.config?.hasWebhookSecret ? '•••••••• (configurado)' : 'App Secret de Meta'}
            />
            <p className="text-xs text-slate-500">
              App Secret de tu app de Meta. Se usa para verificar la firma HMAC del webhook.
              Se almacena cifrado. Déjalo vacío para mantener el actual.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Send className="w-3 h-3" />
              <span className="font-semibold">Webhook URL</span>
            </div>
            <code className="text-xs text-slate-800 break-all">{webhookUrl}</code>
            <p className="text-xs text-slate-500 mt-1">
              Configura esta URL en Meta Developers → Webhooks → Instagram → Subscribe.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !igAccountId || !webhookVerifyToken}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : status.configured ? (
                <Save className="w-4 h-4 mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {status.configured ? 'Guardar cambios' : 'Conectar Instagram'}
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
          <CardTitle className="text-sm">Cómo configurar Instagram DM</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-slate-600 space-y-2">
          <p>
            <strong>1.</strong> Crea una app en{' '}
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 hover:underline"
            >
              Meta Developers
            </a>{' '}
            con Instagram Graph API habilitada.
          </p>
          <p>
            <strong>2.</strong> Conecta tu Instagram Business Account a una Página de Facebook.
          </p>
          <p>
            <strong>3.</strong> Genera un Permanent Access Token con permisos{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">
              instagram_basic, instagram_manage_messages, pages_manage_metadata
            </code>
            .
          </p>
          <p>
            <strong>4.</strong> En Webhooks, suscribe el campo{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">messages</code> con la URL del webhook
            y el Verify Token.
          </p>
          <p>
            <strong>5.</strong> Pega el App Secret aquí para validar la firma HMAC de cada webhook
            entrante.
          </p>
          <p className="text-amber-700 bg-amber-50 px-3 py-2 rounded border border-amber-200">
            <strong>Importante:</strong> Instagram Messaging API solo está disponible para cuentas
            Business o Creator verificadas. Las cuentas personales no reciben webhooks.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
