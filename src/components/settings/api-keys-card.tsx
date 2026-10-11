'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Key, Plus, Trash2, Copy, Check, Plug, Loader2, ShieldCheck, Terminal } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Tab "API / MCP" de Configuración (Task 27): gestión de API keys del
 * Servidor MCP de ALBRA + instrucciones de conexión para clientes MCP
 * (Claude Desktop/Code, Cursor, etc.).
 * La clave cruda se muestra UNA sola vez al crearla; en el servidor solo
 * vive su hash SHA-256.
 */

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [mcpUrl, setMcpUrl] = useState('/api/mcp')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getApiKeys()
      setKeys(data.apiKeys ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron cargar las claves')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    if (typeof window !== 'undefined') setMcpUrl(`${window.location.origin}/api/mcp`)
  }, [load])

  const handleCreate = async () => {
    try {
      setCreating(true)
      const data = await api.createApiKey({ name: newName.trim() || 'Clave MCP' })
      setNewSecret(data.secret)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear la clave')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (key: ApiKeyRow) => {
    if (!confirm(`¿Revocar la clave "${key.name}"? Los clientes conectados con ella dejarán de funcionar de inmediato.`)) return
    try {
      await api.revokeApiKey(key.id)
      toast.success('Clave revocada')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo revocar la clave')
    }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(`${what} copiado al portapapeles`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar; selecciona el texto manualmente')
    }
  }

  const activeKey = keys.find((k) => !k.revokedAt)
  const snippet = JSON.stringify(
    {
      mcpServers: {
        'albra-crm': {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${activeKey ? `${activeKey.prefix}…TU_CLAVE_COMPLETA` : 'albra_TU_CLAVE'}` },
        },
      },
    },
    null,
    2
  )
  const cliCommand = `claude mcp add --transport http albra-crm ${mcpUrl} --header "Authorization: Bearer albra_TU_CLAVE"`

  return (
    <div className="space-y-6">
      {/* Estado del Servidor MCP */}
      <Card className="border-0 shadow-sm bg-emerald-50/50">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-100">
              <Plug className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-emerald-900">Servidor MCP activado</h3>
              <p className="text-sm mt-1 text-emerald-700">
                Cualquier IA externa (Claude Desktop, Claude Code, Cursor…) puede operar este CRM: crear clientes,
                mover oportunidades del pipeline, consultar cotizaciones y enviar WhatsApp. Cada clave queda
                aislada a esta organización y puedes revocarla cuando quieras.
              </p>
              <p className="text-xs mt-2 font-mono text-emerald-800/80 bg-emerald-100/60 rounded px-2 py-1 inline-block max-w-full overflow-x-auto whitespace-nowrap">
                POST {mcpUrl}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Claves */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="w-4 h-4 text-slate-500" /> Claves de API
              </CardTitle>
              <CardDescription className="mt-1">
                La clave completa se muestra una sola vez al crearla. Guarda la copia que necesites antes de cerrar el diálogo.
              </CardDescription>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => { setNewName(''); setNewSecret(null); setCreateOpen(true) }}>
              <Plus className="w-4 h-4" /> Nueva clave
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              Sin claves todavía. Crea una para conectar tu primera IA.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">{k.name}</span>
                      {k.revokedAt ? (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-500">Revocada</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Activa</Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono">{k.prefix}…</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Creada {new Date(k.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {k.lastUsedAt && ` · Último uso ${new Date(k.lastUsedAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                  {!k.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 flex-shrink-0"
                      onClick={() => handleRevoke(k)}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Revocar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cómo conectar */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-500" /> Cómo conectar una IA externa
          </CardTitle>
          <CardDescription>
            Agrega el servidor MCP con la URL de arriba y el header con tu clave. Ejemplo de configuración:
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-3">
          <div className="relative">
            <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto whitespace-pre">{snippet}</pre>
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2 w-7 h-7 text-slate-300 hover:text-white hover:bg-slate-700"
              onClick={() => copy(snippet, 'La configuración')}
              aria-label="Copiar configuración"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <div className="text-xs text-slate-500">
            <span className="font-medium text-slate-600">Claude Code / CLI:</span>{' '}
            <code className="bg-slate-100 rounded px-1.5 py-0.5 break-all">{cliCommand}</code>
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>
              Trata cada clave como una contraseña: quien la tenga puede crear clientes, mover negocios y enviar
              mensajes como tu empresa. Revócala si dejas de usarla.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Diálogo de creación */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{newSecret ? 'Clave creada' : 'Nueva clave de API'}</DialogTitle>
            <DialogDescription>
              {newSecret
                ? 'Cópiala ahora: por seguridad no se volverá a mostrar.'
                : 'Nombra la clave para identificarla (ej. "Claude Desktop", "Asistente de ventas").'}
            </DialogDescription>
          </DialogHeader>
          {newSecret ? (
            <div className="space-y-3">
              <div className="relative">
                <pre className="text-xs bg-slate-900 text-emerald-300 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">{newSecret}</pre>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 w-7 h-7 text-slate-300 hover:text-white hover:bg-slate-700"
                  onClick={() => copy(newSecret, 'La clave')}
                  aria-label="Copiar clave"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Nombre de la clave</Label>
              <Input
                id="api-key-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Claude Desktop"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              />
            </div>
          )}
          <DialogFooter>
            {newSecret ? (
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setCreateOpen(false); setNewSecret(null) }}>
                Listo
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={handleCreate} disabled={creating}>
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />} Crear clave
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
