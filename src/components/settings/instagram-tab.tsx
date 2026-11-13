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
  metaAppId: string
}

interface IgStatus {
  configured: boolean
  config: IgConfig | null
}


interface InstagramConnection {
  id: string
  accountId: string
  displayName: string | null
  username: string | null
  pageName: string | null
  status: string
  lastVerifiedAt: string | null
}

/** Selector tenant-scoped de cuentas OAuth registradas en ChannelConnection. */
function InstagramConnectionsCard() {
  const [connections, setConnections] = useState<InstagramConnection[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [savingSelection, setSavingSelection] = useState(false)

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true)
    try {
      const token = api.getToken()
      const response = await fetch('/api/instagram/connections', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) throw new Error('No se pudieron cargar las cuentas')
      const data = await response.json() as { connections?: InstagramConnection[] }
      setConnections(data.connections ?? [])
    } catch {
      toast.error('No se pudieron cargar las cuentas Instagram')
    } finally {
      setLoadingConnections(false)
    }
  }, [])

  useEffect(() => { void loadConnections() }, [loadConnections])

  const selectConnection = async () => {
    if (!selectedId) return
    setSavingSelection(true)
    try {
      const token = api.getToken()
      const response = await fetch('/api/instagram/connections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ connectionId: selectedId }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error || 'No se pudo seleccionar la cuenta')
      toast.success('Cuenta seleccionada para el canal Instagram')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo seleccionar la cuenta')
    } finally {
      setSavingSelection(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cuentas de Instagram conectadas</CardTitle>
        <CardDescription>
          Meta puede devolver varias cuentas durante la autorización. Selecciona cuál utilizará el flujo actual de mensajes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadingConnections ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Cargando cuentas…</div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay cuentas OAuth registradas. Conecta Meta para listar las cuentas autorizadas.</p>
        ) : (
          <>
            <div className="space-y-2">
              {connections.map((connection) => (
                <label key={connection.id} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="instagram-connection"
                    value={connection.id}
                    checked={selectedId === connection.id}
                    onChange={() => setSelectedId(connection.id)}
                    disabled={connection.status !== 'connected'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">
                      {connection.username ? `@${connection.username}` : connection.displayName || connection.accountId}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {connection.pageName ? `Página: ${connection.pageName} · ` : ''}ID: {connection.accountId}
                    </span>
                  </span>
                  <Badge variant="outline" className={connection.status === 'connected' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'}>
                    {connection.status === 'connected' ? 'Conectada' : connection.status}
                  </Badge>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void selectConnection()} disabled={!selectedId || savingSelection}>
                {savingSelection ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                Usar esta cuenta
              </Button>
              <Button type="button" variant="outline" onClick={() => void loadConnections()} disabled={loadingConnections}>
                <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
              </Button>
            </div>
            <p className="text-xs text-amber-700">
              La selección cambia la cuenta activa del flujo legacy; el enrutamiento de webhooks y conversaciones por conexión aún está pendiente.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
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
  const [metaAppId, setMetaAppId] = useState('')
  const [connecting, setConnecting] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getInstagramConfig()
      setStatus(data)
      if (data.config) {
        setIgAccountId(data.config.igAccountId || '')
        setAccessToken(data.config.accessToken || '')
        setWebhookVerifyToken(data.config.webhookVerifyToken || '')
        setMetaAppId(data.config.metaAppId || '')
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

  // Retorno del OAuth de Meta: /settings?tab=instagram&ig_connected=... | ig_error=...
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('ig_connected')
    const igError = params.get('ig_error')
    if (!connected && !igError) return
    if (connected) {
      toast.success(`Instagram @${connected} conectado mediante Meta`)
      void loadConfig()
    }
    if (igError) {
      const msgs: Record<string, string> = {
        missing_app_credentials:
          'Falta el App ID o el App Secret de tu app de Meta. Complétalos aquí y vuelve a intentar.',
        user_cancel: 'Autorización cancelada en Meta.',
        access_denied: 'Meta denegó el acceso. Revisa los permisos de tu app.',
        csrf_invalid: 'Sesión de autorización inválida. Vuelve a pulsar «Conectar mediante Meta».',
        csrf_expired: 'La autorización expiró (10 min). Vuelve a pulsar «Conectar mediante Meta».',
        token_exchange_failed:
          'Meta rechazó el código. Verifica App ID, App Secret y que la URL de redirección esté registrada en tu app.',
        long_lived_token_failed: 'No se pudo extender el token. Revisa el App Secret.',
        pages_fetch_failed: 'No se pudieron listar tus páginas de Facebook.',
        no_ig_business_linked:
          'Ninguna Página de Facebook tiene una cuenta de Instagram Business/Creator vinculada.',
      }
      toast.error(msgs[igError] || `Error de conexión con Meta: ${igError}`)
    }
    window.history.replaceState({}, '', '/settings?tab=instagram')
  }, [loadConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.saveInstagramConfig({
        igAccountId,
        accessToken: accessToken.startsWith('••••') ? undefined : accessToken,
        webhookVerifyToken,
        webhookSecret: webhookSecret || undefined,
        metaAppId,
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

  // Flujo ManyChat: navegador → /api/instagram/oauth/start → diálogo de Meta.
  // No es una llamada fetch: Meta exige navegación superior para mostrar el diálogo.
  const handleMetaConnect = () => {
    if (!metaAppId.trim()) {
      toast.error('Primero guarda el App ID de tu app de Meta (campo de abajo).')
      return
    }
    if (!status.config?.hasWebhookSecret) {
      toast.error('Primero guarda el App Secret de tu app de Meta (campo «App Secret (HMAC)»).')
      return
    }
    setConnecting(true)
    window.location.href = '/api/instagram/oauth/start'
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/instagram/webhook`
      : '/api/instagram/webhook'

  const oauthCallbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/instagram/oauth/callback`
      : '/api/instagram/oauth/callback'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <InstagramConnectionsCard />
      {/* ============ Conexión automática estilo ManyChat (OAuth Meta) ============ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-500 rounded-lg flex items-center justify-center">
                <Instagram className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Canal de Instagram
                  {status.config?.isActive && (
                    <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Comienza a comunicarte con tus clientes mediante mensajes de Instagram
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ig-meta-app-id">App ID de tu app de Meta</Label>
            <div className="flex gap-2">
              <Input
                id="ig-meta-app-id"
                value={metaAppId}
                onChange={(e) => setMetaAppId(e.target.value)}
                placeholder="1234567890123456"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={saving || !metaAppId}
                className="shrink-0"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Guardar
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              El App ID es público (Meta Developers &gt; Tu app &gt; Configuración básica). El App
              Secret va cifrado en el campo «App Secret (HMAC)» de la configuración manual de abajo.
            </p>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Send className="w-3 h-3" />
              <span className="font-semibold">URL de redirección OAuth (regístrala en tu app de Meta)</span>
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
            className="w-full h-11 text-white font-semibold bg-[#1877F2] hover:bg-[#166fe5]"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Instagram className="w-4 h-4 mr-2" />
            )}
            Conectar mediante Meta
          </Button>
          <p className="text-xs text-slate-500 -mt-2">
            Igual que ManyChat: te llevamos a Meta para autorizar la cuenta y volvemos con el token
            guardado cifrado (AES-256-GCM). Tu app de Meta debe tener tu cuenta como administrador
            o desarrollador — así no necesitas revisión de Meta para empezar.
          </p>
        </CardContent>
      </Card>

      {/* ============ Configuración manual (avanzada) ============ */}
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
                  Configuración manual (avanzada) — token y webhook sin OAuth
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
