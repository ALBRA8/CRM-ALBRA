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
import { Save, Trash2, Eye, EyeOff, Loader2, Instagram, Send, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

/** Icono TikTok (nota musical) — lucide no lo trae */
function TikTokIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-2.31-2.83V9.35a6.35 6.35 0 1 0 5.76 6.32V8.75a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.18Z" />
    </svg>
  )
}

interface TtConfig {
  openId: string
  displayName: string
  accessToken: string // enmascarado
  appKey: string
  hasAppSecret: boolean
  webhookVerifyToken: string
  extraScopes: string
  sendEndpoint: string
  isActive: boolean
  hasAccessToken: boolean
}

interface TtStatus {
  configured: boolean
  config: TtConfig | null
}

export function TikTokTab() {
  const [status, setStatus] = useState<TtStatus>({ configured: false, config: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [extraScopes, setExtraScopes] = useState('')
  const [sendEndpoint, setSendEndpoint] = useState('')
  const [connecting, setConnecting] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getTikTokConfig()
      setStatus(data)
      if (data.config) {
        setAppKey(data.config.appKey || '')
        setWebhookVerifyToken(data.config.webhookVerifyToken || '')
        setExtraScopes(data.config.extraScopes || '')
        setSendEndpoint(data.config.sendEndpoint || '')
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

  // Retorno del OAuth de TikTok: /settings?tab=tiktok&tt_connected=... | tt_error=...
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('tt_connected')
    const ttError = params.get('tt_error')
    if (!connected && !ttError) return
    if (connected) {
      toast.success(`TikTok conectado: ${connected}`)
      void loadConfig()
    }
    if (ttError) {
      const msgs: Record<string, string> = {
        missing_app_key: 'Falta el App Key de tu app de TikTok. Complétalo aquí y vuelve a intentar.',
        user_cancel: 'Autorización cancelada en TikTok.',
        csrf_invalid: 'Sesión de autorización inválida. Vuelve a pulsar «Conectar TikTok».',
        csrf_expired: 'La autorización expiró (10 min). Vuelve a pulsar «Conectar TikTok».',
        token_exchange_failed:
          'TikTok rechazó el código. Verifica App Key, App Secret y que la URL de redirección esté registrada en tu app.',
      }
      toast.error(msgs[ttError] || `Error de conexión con TikTok: ${ttError}`)
    }
    window.history.replaceState({}, '', '/settings?tab=tiktok')
  }, [loadConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.saveTikTokConfig({
        appKey,
        appSecret: appSecret.startsWith('••••') ? undefined : appSecret || undefined,
        webhookVerifyToken,
        extraScopes: extraScopes || undefined,
        sendEndpoint: sendEndpoint || undefined,
      })
      toast.success('Configuración de TikTok guardada')
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
    if (!confirm('¿Desconectar TikTok?')) return
    try {
      await api.disconnectTikTok()
      toast.success('TikTok desconectado')
      await loadConfig()
      setAppKey('')
      setWebhookVerifyToken('')
      setExtraScopes('')
      setSendEndpoint('')
    } catch {
      toast.error('Error al desconectar')
    }
  }

  // Flujo ManyChat: navegador → /api/tiktok/oauth/start → diálogo de TikTok.
  const handleTikTokConnect = () => {
    if (!appKey.trim()) {
      toast.error('Primero guarda el App Key de tu app de TikTok.')
      return
    }
    setConnecting(true)
    window.location.href = '/api/tiktok/oauth/start'
  }

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/tiktok/webhook` : '/api/tiktok/webhook'

  const oauthCallbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/tiktok/oauth/callback`
      : '/api/tiktok/oauth/callback'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ============ Conexión estilo ManyChat (Login Kit TikTok) ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
                <TikTokIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Canal de TikTok
                  {status.config?.isActive && (
                    <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Comienza a comunicarte con tus clientes mediante mensajes de TikTok
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
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-800 mb-1">Requisito: cuenta de TikTok de empresa</p>
            <p>
              TikTok solo permite conectar cuentas de empresa (igual que ManyChat). En la app:
              Perfil → Menú → Configuración y privacidad → Cuenta → «Cambiar a cuenta de empresa».
              Creator y personales no reciben mensajes por API.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tt-app-key">App Key de tu app de TikTok (client_key)</Label>
            <div className="flex gap-2">
              <Input
                id="tt-app-key"
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder="awxxxxxx..."
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={saving || !appKey}
                className="shrink-0"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Guardar
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              App Key es pública (developers.tiktok.com → tu app → Basic information). El App Secret
              va cifrado en la configuración manual de abajo.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Send className="w-3 h-3" />
              <span className="font-semibold">URL de redirección Login Kit (regístrala en tu app de TikTok)</span>
            </div>
            <code className="text-xs text-slate-800 break-all">{oauthCallbackUrl}</code>
            <p className="text-xs text-slate-500 mt-1">
              developers.tiktok.com → Tu app → Login Kit → Redirect URI. Debe coincidir exactamente.
            </p>
          </div>

          <Button
            onClick={handleTikTokConnect}
            disabled={connecting || !appKey}
            className="w-full h-11 text-white font-semibold bg-black hover:bg-slate-800"
          >
            {connecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TikTokIcon className="w-4 h-4 mr-2" />}
            Conectar TikTok
          </Button>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-800 mb-1">Estado de los mensajes directos (DM)</p>
            <p>
              La identidad y conexión OAuth funcionan hoy. Los DM por API (recibir y responder
              mensajes) están vetados por TikTok al programa de socios — ManyChat tiene ese acceso
              como TikTok Marketing Partner. El CRM queda <strong>cableado al 100%</strong>: cuando
              TikTok apruebe tu app, activas los DM registrando el endpoint de envío abajo, sin
              cambios de código. Muchos negocios ya aprovechan hoy el canal para comentarios,
              contenido y captación.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ============ Configuración manual (avanzada) ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Configuración manual (avanzada)</CardTitle>
          <CardDescription className="text-xs">
            App Secret, webhook y parámetros del Business Messaging API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tt-app-secret">App Secret de TikTok</Label>
            <div className="flex gap-2">
              <Input
                id="tt-app-secret"
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={status.config?.hasAppSecret ? '•••••••• (configurado)' : 'App Secret'}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowSecret((s) => !s)}>
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-slate-500">Se almacena cifrado con AES-256-GCM. Vacío = mantener el actual.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tt-verify-token">Webhook Verify Token</Label>
            <Input
              id="tt-verify-token"
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="crm_albra_tt_verify_..."
            />
            <p className="text-xs text-slate-500">Token que configuras en TikTok Developers → Webhooks.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tt-extra-scopes">Scopes adicionales (aprobados por TikTok)</Label>
            <Input
              id="tt-extra-scopes"
              value={extraScopes}
              onChange={(e) => setExtraScopes(e.target.value)}
              placeholder={status.config?.extraScopes || 'separados por coma, ej: im:chat.access'}
            />
            <p className="text-xs text-slate-500">
              user_info.basic se pide siempre. Añade aquí los scopes de mensajería que TikTok
              apruebe a tu app.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tt-send-endpoint">Endpoint de envío Business Messaging</Label>
            <Input
              id="tt-send-endpoint"
              value={sendEndpoint}
              onChange={(e) => setSendEndpoint(e.target.value)}
              placeholder={status.config?.sendEndpoint || 'vacío hasta que TikTok lo asigne'}
            />
            <p className="text-xs text-slate-500">
              Ruta del API de mensajes que TikTok entrega al aprobar el acceso de socio. Con ella
              registrada, el auto-responder IA queda activo en TikTok.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Instagram className="w-3 h-3" />
              <span className="font-semibold">Webhook URL (TikTok Developers → Webhooks)</span>
            </div>
            <code className="text-xs text-slate-800 break-all">{webhookUrl}</code>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar configuración
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
    </div>
  )
}
