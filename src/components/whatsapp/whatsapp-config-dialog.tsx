'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { MessageCircle, ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface WhatsAppConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: Record<string, unknown> | null
  onSaved: () => void
}

export function WhatsAppConfigDialog({ open, onOpenChange, config, onSaved }: WhatsAppConfigDialogProps) {
  const [phoneNumberId, setPhoneNumberId] = useState((config?.phoneNumberId as string) || '')
  const [businessAccountId, setBusinessAccountId] = useState((config?.businessAccountId as string) || '')
  const [accessToken, setAccessToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState((config?.webhookVerifyToken as string) || '')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [showInstructions, setShowInstructions] = useState(!config)

  const handleSave = async () => {
    if (!phoneNumberId || !businessAccountId || !accessToken || !webhookVerifyToken) {
      toast.error('Todos los campos marcados son requeridos')
      return
    }

    setSaving(true)
    try {
      await api.updateWhatsAppConfig({
        phoneNumberId,
        businessAccountId,
        accessToken,
        webhookVerifyToken,
        webhookSecret: webhookSecret || undefined,
      })
      toast.success('Configuración de WhatsApp guardada exitosamente')
      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error('Error al guardar la configuración')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!phoneNumberId || !accessToken) {
      toast.error('Se requiere Phone Number ID y Access Token para probar')
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }
      )
      if (response.ok) {
        setTestResult('success')
        toast.success('Conexión exitosa con Meta WhatsApp API')
      } else {
        setTestResult('error')
        toast.error('Error de conexión. Verifica tus credenciales.')
      }
    } catch {
      setTestResult('error')
      toast.error('Error de conexión')
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setSaving(true)
    try {
      await api.disconnectWhatsApp()
      toast.success('WhatsApp desconectado')
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error('Error al desconectar WhatsApp')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-emerald-500" />
            Configurar WhatsApp Business
          </DialogTitle>
          <DialogDescription>
            Conecta tu cuenta de Meta WhatsApp Business API para recibir y enviar mensajes automáticamente.
          </DialogDescription>
        </DialogHeader>

        {showInstructions && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-xs space-y-2">
              <p className="font-semibold text-blue-800">Pasos para configurar:</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-700">
                <li>Ve a Meta for Developers y crea una app</li>
                <li>Agrega el producto WhatsApp Business API</li>
                <li>Obtén el Phone Number ID y Business Account ID</li>
                <li>Genera un Access Token permanente</li>
                <li>Configura el webhook con tu verify token</li>
              </ol>
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
              >
                Documentación oficial <ExternalLink className="w-3 h-3" />
              </a>
              <div className="pt-2">
                <p className="font-semibold text-blue-800">URL del Webhook:</p>
                <code className="text-xs bg-blue-100 px-2 py-1 rounded break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '/api/whatsapp/webhook'}
                </code>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="phoneNumberId" className="text-sm font-medium">
              Phone Number ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="Ej: 123456789012345"
            />
            <p className="text-xs text-slate-500">Se encuentra en WhatsApp &gt; Phone Numbers en Meta</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessAccountId" className="text-sm font-medium">
              Business Account ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="businessAccountId"
              value={businessAccountId}
              onChange={(e) => setBusinessAccountId(e.target.value)}
              placeholder="Ej: 987654321098765"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken" className="text-sm font-medium">
              Access Token <span className="text-red-500">*</span>
            </Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={config?.accessToken ? 'Token configurado (ingresa nuevo para cambiar)' : 'EAMx...'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookVerifyToken" className="text-sm font-medium">
              Webhook Verify Token <span className="text-red-500">*</span>
            </Label>
            <Input
              id="webhookVerifyToken"
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="mi_token_secreto_de_verificacion"
            />
            <p className="text-xs text-slate-500">Token que configures en Meta para verificar el webhook</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookSecret" className="text-sm font-medium">
              App Secret (opcional)
            </Label>
            <Input
              id="webhookSecret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Para verificación de firma del webhook"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || !phoneNumberId || !accessToken}
            >
              {testing ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : testResult === 'success' ? (
                <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-500" />
              ) : testResult === 'error' ? (
                <XCircle className="w-4 h-4 mr-1 text-red-500" />
              ) : null}
              Probar Conexión
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowInstructions(!showInstructions)}
            >
              {showInstructions ? 'Ocultar' : 'Ver'} instrucciones
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {config?.isActive && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={saving}
            >
              Desconectar
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : null}
            Guardar Configuración
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
