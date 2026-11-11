'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp'
import { ShieldCheck, ShieldOff, Loader2, Copy, CheckCircle, AlertTriangle, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

interface TwoFactorState {
  enabled: boolean
  pendingSetup: boolean
  recoveryCodesLeft: number
}

/**
 * TwoFactorCard — (OLEADA 2) gestión del segundo factor TOTP del usuario:
 *  - estado (activo / inactivo / enrolamiento pendiente);
 *  - enrolamiento: QR + secreto manual + confirmación con código de 6 dígitos;
 *  - códigos de recuperación mostrados UNA sola vez al activar;
 *  - desactivación con contraseña + código (defensa en profundidad).
 */
export function TwoFactorCard() {
  const [state, setState] = useState<TwoFactorState | null>(null)
  const [loading, setLoading] = useState(true)

  // Enrolamiento
  const [enrolling, setEnrolling] = useState(false)
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qrDataUrl: string } | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [enabling, setEnabling] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  // Desactivación
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disabling, setDisabling] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const s = (await api.get2faStatus()) as TwoFactorState
      setState(s)
    } catch {
      toast.error('No se pudo cargar el estado del segundo factor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startSetup = async () => {
    setEnrolling(true)
    try {
      const s = (await api.setup2fa()) as { secret: string; otpauthUri: string; qrDataUrl: string }
      setSetup(s)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo iniciar la configuración')
    } finally {
      setEnrolling(false)
    }
  }

  const confirmEnable = async () => {
    if (!enableCode.trim()) return
    setEnabling(true)
    try {
      const r = (await api.enable2fa({ code: enableCode.trim() })) as { enabled: boolean; recoveryCodes: string[] }
      setRecoveryCodes(r.recoveryCodes)
      setSetup(null)
      setEnableCode('')
      await refresh()
      toast.success('Verificación en dos pasos activada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Código inválido')
    } finally {
      setEnabling(false)
    }
  }

  const copySecret = async () => {
    if (!setup) return
    try {
      await navigator.clipboard.writeText(setup.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const confirmDisable = async () => {
    if (!disablePassword || !disableCode.trim()) return
    setDisabling(true)
    try {
      await api.disable2fa({ password: disablePassword, code: disableCode.trim() })
      setDisablePassword('')
      setDisableCode('')
      await refresh()
      toast.success('Verificación en dos pasos desactivada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo desactivar')
    } finally {
      setDisabling(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${state?.enabled ? 'bg-emerald-100' : 'bg-slate-100'}`}>
              {state?.enabled ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldOff className="w-5 h-5 text-slate-500" />}
            </div>
            <div>
              <CardTitle className="text-base">Verificación en dos pasos (2FA)</CardTitle>
              <CardDescription>Protege tu cuenta con un código TOTP de tu app autenticadora</CardDescription>
            </div>
          </div>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : state?.enabled ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Activa</Badge>
          ) : state?.pendingSetup ? (
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pendiente de confirmar</Badge>
          ) : (
            <Badge variant="secondary">Inactiva</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---- Estado activo: opción de desactivar ---- */}
        {state?.enabled && !recoveryCodes && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-slate-600 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                Tu cuenta exige un código TOTP (o un código de recuperación) al iniciar sesión.
                {typeof state.recoveryCodesLeft === 'number' && (
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Códigos de recuperación sin usar: {state.recoveryCodesLeft}
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="2fa-disable-pass" className="text-xs">Contraseña actual</Label>
                <Input id="2fa-disable-pass" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="2fa-disable-code" className="text-xs">Código TOTP o de recuperación</Label>
                <Input id="2fa-disable-code" type="text" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456 ó XXXX-XXXX" className="font-mono" autoComplete="off" />
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={confirmDisable} disabled={disabling || !disablePassword || !disableCode.trim()}>
              {disabling ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ShieldOff className="w-4 h-4 mr-1.5" />}
              Desactivar 2FA
            </Button>
          </div>
        )}

        {/* ---- Códigos de recuperación recién generados (UNA sola vez) ---- */}
        {recoveryCodes && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="w-4 h-4" />
              Guarda estos códigos AHORA — no se mostrarán de nuevo
            </div>
            <p className="text-xs text-amber-700">Son tu llave de emergencia si pierdes la app autenticadora. Cada código sirve una sola vez.</p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm text-slate-800 bg-white rounded-lg border border-amber-200 p-3">
              {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <Button size="sm" variant="outline" onClick={() => setRecoveryCodes(null)}>Ya los guardé</Button>
          </div>
        )}

        {/* ---- Enrolamiento: QR + confirmación ---- */}
        {!state?.enabled && !recoveryCodes && (
          <div className="space-y-4">
            {!setup ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Añade una capa extra de seguridad: cada inicio de sesión pedirá un código de 6 dígitos.
                </p>
                <Button size="sm" onClick={startSetup} disabled={enrolling}>
                  {enrolling ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />}
                  Configurar
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qrDataUrl} alt="QR de configuración TOTP" className="rounded-lg border border-slate-200" width={160} height={160} />
                  <div className="space-y-2 text-sm">
                    <p className="text-slate-700 font-medium">1. Escanea el QR con tu app (Google Authenticator, Authy, 1Password…)</p>
                    <div className="space-y-1">
                      <p className="text-slate-600">2. O ingresa el código manual:</p>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs bg-slate-100 rounded px-2 py-1 break-all max-w-[220px]">{setup.secret}</code>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={copySecret} aria-label="Copiar secreto">
                          {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                    <p className="text-slate-600">3. Ingresa el código de 6 dígitos que muestra la app:</p>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <InputOTP maxLength={6} value={enableCode} onChange={(v) => setEnableCode(v.replace(/\D/g, ''))}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={confirmEnable} disabled={enabling || enableCode.length < 6}>
                      {enabling ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1.5" />}
                      Activar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setSetup(null); setEnableCode('') }}>Cancelar</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
