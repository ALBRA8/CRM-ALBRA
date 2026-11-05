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
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'

/** Icono Messenger (rayo) — lucide no lo trae */
export function MessengerIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.913 1.454 5.51 3.722 7.208V22l3.405-1.869c.899.249 1.855.383 2.873.383 5.523 0 10-4.145 10-9.255C22 6.145 17.523 2 12 2zm1.008 12.461-2.546-2.716-4.969 2.716 5.464-5.797 2.607 2.716 4.908-2.716-5.464 5.797z" />
    </svg>
  )
}

interface FbConfig {
  pageId: string
  pageName: string
  userEmail: string
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

interface IgMetaConfig {
  config: { metaAppId?: string; hasWebhookSecret?: boolean } | null
}

export function FacebookTab() {
  const [status, setStatus] = useState<FbStatus>({ configured: false, config: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // App de Meta COMPARTIDA con Instagram (misma app sirve IG + Messenger)
  const [metaAppId, setMetaAppId] = useState('')
  const [savingAppId, setSavingAppId] = useState(false)
  const [connecting, setConnecting] = useState(false)

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

  const loadMetaAppId = useCallback(async () => {
    try {
      const data = (await api.getInstagramConfig()) as IgMetaConfig
      setMetaAppId(data.config?.metaAppId || '')
    } catch {
      // La app de Meta aún no está configurada
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void loadMetaAppId()
  }, [loadConfig, loadMetaAppId])

  // Guarda el App ID en el MISMO blob cifrado que usa Instagram (misma app de Meta)
  const handleSaveAppId = async () => {
    setSavingAppId(true)
    try {
      await api.saveInstagramConfig({ metaAppId })
      toast.success('App ID de Meta guardado (compartido con Instagram)')
      await loadMetaAppId()
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar el App ID')
    } finally {
      setSavingAppId(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.saveFacebookConfig({
        pageId,
        pageToken: pageToken.startsWith('••••') ? undefined : pageToken,
        webhookVerifyToken,
        appSecret: appSecret || undefined,
      })
      toast.success('Configuración de Messenger guardada')
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
    if (!confirm('¿Desconectar Messenger?')) return
    try {
      await api.disconnectFacebook()
      toast.success('Messenger desconectado')
      await loadConfig()
      setPageId('')
      setPageToken('')
      setWebhookVerifyToken('')
    } catch {
      toast.error('Error al desconectar')
    }
  }

  // Flujo ManyChat: navegador → /api/facebook/oauth/start → diálogo de Meta.
  // No es una llamada fetch: Meta exige navegación superior para mostrar el diálogo.
  const handleMetaConnect = () => {
    if (!metaAppId.trim()) {
      toast.error('Primero guarda el App ID de tu app de Meta (campo de arriba).')
      return
    }
    setConnecting(true)
    window.location.href = '/api/facebook/oauth/start'
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/facebook/webhook`
      : '/api/facebook/webhook'

  const oauthCallbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/facebook/oauth/callback`
      : '/api/facebook/oauth/callback'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ============ Conexión automática estilo ManyChat (OAuth Meta Messenger) ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#0084FF] rounded-lg flex items-center justify-center">
                <MessengerIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Canal de Messenger
                  {status.config?.isActive && (
                    <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Comienza a comunicarte con tus clientes mediante los mensajes de tu Página de Facebook
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Estado conectado vía OAuth: nombre de Página + email + badge de cifrado */}
          {status.config?.isActive && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-slate-700 space-y-1">
              <p className="flex items-center gap-2">
                <Facebook className="w-3.5 h-3.5 text-[#1877F2]" />
                <span className="font-semibold text-slate-800">
                  {status.config.pageName || status.config.pageId || 'Página de Facebook'}
                </span>
                {status.config.pageId && (
                  <code className="text-slate-500">({status.config.pageId})</code>
                )}
              </p>
              {status.config.userEmail && (
                <p className="flex items-center gap-2 text-slate-600">
                  <UserRound className="w-3.5 h-3.5 text-slate-400" />
                  Autorizada por {status.config.userEmail}
                </p>
              )}
              <p className="flex items-center gap-2 text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                Page Token cifrado en reposo con AES-256-GCM
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fb-meta-app-id">App ID de tu app de Meta (la misma de Instagram)</Label>
            <div className="flex gap-2">
              <Input
                id="fb-meta-app-id"
                value={metaAppId}
                onChange={(e) => setMetaAppId(e.target.value)}
                placeholder="1234567890123456"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveAppId}
                disabled={savingAppId || !metaAppId}
                className="shrink-0"
              >
                {savingAppId ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Guardar
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Una sola app de Meta sirve para Instagram y Messenger (se guarda cifrada junto a la
              configuración de Instagram). El App Secret va en el campo «App Secret (HMAC)» de la
              configuración avanzada de abajo.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Send className="w-3 h-3" />
              <span className="font-semibold">URI de redirección OAuth (regístrala en tu app de Meta)</span>
            </div>
            <code className="text-xs text-slate-800 break-all">{oauthCallbackUrl}</code>
            <p className="text-xs text-slate-500 mt-1">
              Meta Developers &gt; Tu app &gt; Facebook Login &gt; Configuración &gt; URI de
              redirección OAuth válidos. Debe coincidir exactamente.
            </p>
          </div>

          <Button
            onClick={handleMetaConnect}
            disabled={connecting || !metaAppId}
            className="w-full h-11 text-white font-semibold bg-gradient-to-r from-[#0084FF] to-[#0068FF] hover:from-[#0072e6] hover:to-[#005ce6]"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MessengerIcon className="w-4 h-4 mr-2" />
            )}
            Conectar mediante Meta
          </Button>
          <p className="text-xs text-slate-500 -mt-2">
            Igual que ManyChat: te llevamos a Meta para autorizar tu Página y volvemos con el token
            guardado cifrado (AES-256-GCM), el webhook suscrito y el canal activo. Tu app de Meta
            debe tener tu cuenta como administrador — así no necesitas revisión de Meta.
          </p>
        </CardContent>
      </Card>

      {/* ============ Configuración manual (avanzada) — método alternativo sin OAuth ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center">
                <Facebook className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Messenger — Configuración manual (avanzada)
                </CardTitle>
                <CardDescription>
                  Método alternativo sin OAuth: Page ID, Page Token y Verify Token pegados a mano
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
              HMAC del webhook y para el intercambio OAuth. Se almacena cifrado. Déjalo vacío para
              mantener el actual.
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
              {status.configured ? 'Guardar cambios' : 'Conectar Messenger'}
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
          <CardTitle className="text-sm">Cómo configurar Messenger</CardTitle>
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
            <strong>2.</strong> Registra la <strong>URI de redirección OAuth</strong> de arriba en
            Facebook Login &gt; Configuración. Luego pulsa <strong>«Conectar mediante Meta»</strong>:
            el CRM obtiene el token de la Página, lo guarda cifrado y suscribe el webhook solo.
          </p>
          <p>
            <strong>3.</strong> Si prefieres el método manual: vincula tu Página a la app
            (Messenger &gt; Settings &gt; Access Tokens), copia el <strong>Page Access Token</strong>{' '}
            y pégalo en la configuración avanzada.
          </p>
          <p>
            <strong>4.</strong> En Webhooks, suscribe la Página con la URL del webhook, el Verify
            Token y el campo{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">messages</code> (con OAuth el CRM ya
            lo intenta automáticamente).
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
