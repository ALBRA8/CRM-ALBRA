'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bell, BellOff, Loader2, CheckCircle, XCircle, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface PushState {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  loading: boolean
}

/**
 * Componente para que el usuario habilite notificaciones push en su navegador.
 * Maneja el registro del Service Worker, la solicitud de permiso y la
 * suscripción al push service del navegador.
 */
export function PushNotificationsCard() {
  const [state, setState] = useState<PushState>({
    supported: false,
    permission: 'default',
    subscribed: false,
    loading: true,
  })

  const checkStatus = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState({ supported: false, permission: 'unsupported', subscribed: false, loading: false })
      return
    }

    const permission = Notification.permission
    let subscribed = false

    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg && 'pushManager' in reg) {
        const sub = await reg.pushManager.getSubscription()
        subscribed = !!sub
      }
    } catch {
      // ignore
    }

    setState({ supported: true, permission, subscribed, loading: false })
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const prev = await checkStatus()
      if (!cancelled) return prev
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [checkStatus])

  const handleEnable = async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      // 1. Pedir permiso
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error('Permiso de notificaciones denegado')
        setState((s) => ({ ...s, permission, loading: false }))
        return
      }

      // 2. Registrar el Service Worker
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready

      // 3. Obtener VAPID public key del backend
      const vapidRes = await fetch('/api/push/vapid')
      const { publicKey } = await vapidRes.json() as { publicKey: string }

      // 4. Suscribirse al push service del navegador
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      })

      // 5. Enviar la suscripción al backend
      const subJson = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify(subJson),
      })

      toast.success('Notificaciones push habilitadas')
      setState((s) => ({ ...s, permission, subscribed: true, loading: false }))
    } catch (err) {
      console.error('Push subscription error:', err)
      toast.error('Error al habilitar notificaciones')
      setState((s) => ({ ...s, loading: false }))
    }
  }

  const handleDisable = async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          const endpoint = sub.endpoint
          await sub.unsubscribe()
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${api.getToken()}`,
            },
            body: JSON.stringify({ endpoint }),
          })
        }
      }
      toast.success('Notificaciones push deshabilitadas')
      setState((s) => ({ ...s, subscribed: false, loading: false }))
    } catch (err) {
      console.error('Push unsubscribe error:', err)
      toast.error('Error al deshabilitar')
      setState((s) => ({ ...s, loading: false }))
    }
  }

  if (state.loading) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Verificando soporte de notificaciones...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!state.supported) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <BellOff className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-base">Notificaciones Push</CardTitle>
              <CardDescription>Tu navegador no soporta notificaciones push</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${state.subscribed ? 'bg-emerald-100' : 'bg-slate-100'}`}>
              {state.subscribed ? <Bell className="w-5 h-5 text-emerald-600" /> : <Bell className="w-5 h-5 text-slate-400" />}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Notificaciones Push
                {state.subscribed && <Badge className="bg-emerald-100 text-emerald-700">Activadas</Badge>}
              </CardTitle>
              <CardDescription>
                Recibe avisos en tu celular cuando el agente requiera atención humana
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Soporte del navegador:</span>
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle className="w-3 h-3" /> Compatible
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Permiso:</span>
            <span className={`flex items-center gap-1 font-medium ${state.permission === 'granted' ? 'text-emerald-600' : state.permission === 'denied' ? 'text-red-600' : 'text-slate-500'}`}>
              {state.permission === 'granted' ? (
                <><CheckCircle className="w-3 h-3" /> Concedido</>
              ) : state.permission === 'denied' ? (
                <><XCircle className="w-3 h-3" /> Bloqueado</>
              ) : (
                <><Bell className="w-3 h-3" /> Pendiente</>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Suscripción:</span>
            <span className={`flex items-center gap-1 font-medium ${state.subscribed ? 'text-emerald-600' : 'text-slate-500'}`}>
              {state.subscribed ? <><CheckCircle className="w-3 h-3" /> Activa</> : <><XCircle className="w-3 h-3" /> Inactiva</>}
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-500 flex items-start gap-1.5">
          <Smartphone className="w-3 h-3 mt-0.5 flex-shrink-0" />
          Al activar, recibirás avisos instantáneos en este dispositivo cuando lleguen mensajes
          de WhatsApp/Telegram/Instagram, el agente transfiera a humano o una automatización dispare.
        </p>

        {state.permission === 'denied' ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            Bloqueaste las notificaciones en este navegador. Para reactivarlas, abre la configuración
            de notificaciones del sitio en tu navegador (ícono de candado en la URL) y permite
            notificaciones para CRM ALBRA.
          </div>
        ) : state.subscribed ? (
          <Button variant="outline" onClick={handleDisable} disabled={state.loading}>
            <BellOff className="w-4 h-4 mr-2" />
            Deshabilitar notificaciones
          </Button>
        ) : (
          <Button onClick={handleEnable} disabled={state.loading}>
            {state.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bell className="w-4 h-4 mr-2" />}
            Habilitar notificaciones push
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
