'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp'
import { Loader2, Mail, Lock, ArrowRight, ArrowLeft, CheckCircle, ShieldCheck, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

type SessionUser = { id: string; name: string; email: string; company?: string | null; phone?: string | null; role: string; avatar?: string | null }

export function LoginForm() {
  const { setView, setUser, setToken } = useAppStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  // ---- (OLEADA 2) Paso 2FA: ticket provisional emitido tras validar contraseña ----
  const [mfaTicket, setMfaTicket] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRecoveryMode, setMfaRecoveryMode] = useState(false)
  const [mfaLoading, setMfaLoading] = useState(false)

  const completeLogin = (data: { token: string; user: SessionUser }) => {
    // La sesión persiste vía cookie httpOnly (seteada por el servidor);
    // el token solo queda en memoria del store/ApiClient.
    setToken(data.token)
    setUser(data.user)
    api.setToken(data.token)
    setView('dashboard')
    toast.success('¡Bienvenido de vuelta!')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await api.login({ email, password })
      // (OLEADA 2) Si la cuenta tiene 2FA el servidor NO emite sesión: pide
      // el segundo factor con un ticket provisional de 5 minutos.
      if ((data as { mfaRequired?: boolean }).mfaRequired) {
        setMfaTicket((data as { mfaToken: string }).mfaToken)
        setMfaCode('')
        setMfaRecoveryMode(false)
        return
      }
      completeLogin(data as { token: string; user: SessionUser })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar sesión'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaTicket || !mfaCode.trim()) return
    setError('')
    setMfaLoading(true)
    try {
      const data = await api.verify2fa({ mfaToken: mfaTicket, code: mfaCode.trim() })
      completeLogin(data as { token: string; user: SessionUser })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Código inválido'
      setError(message)
      toast.error(message)
    } finally {
      setMfaLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      const data = await res.json()
      setForgotSent(true)
      toast.success('Si el email existe, recibirás un enlace de recuperación')
      // In dev mode, show the token
      if (data.devToken) {
        toast.info(`[DEV] Token: ${data.devToken.slice(0, 20)}...`)
      }
    } catch {
      toast.error('Error al enviar email de recuperación')
    } finally {
      setForgotLoading(false)
    }
  }

  // Forgot password form
  if (showForgot) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-2xl border-0 rounded-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
        <CardHeader className="text-center pb-2 pt-6 px-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight">
            Recuperar Contraseña
          </CardTitle>
          <CardDescription className="text-slate-500 mt-1">
            Te enviaremos un enlace para restablecer tu contraseña
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-2">
          {forgotSent ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Email Enviado</h3>
                <p className="text-sm text-slate-500">
                  Si {forgotEmail} está registrado, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada y spam.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => { setShowForgot(false); setForgotSent(false) }}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Volver al inicio de sesión
              </Button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="forgot-email" className="text-sm font-medium text-slate-700">
                  Correo Electrónico
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="tu@email.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold h-11 rounded-xl shadow-lg shadow-emerald-500/25"
                disabled={forgotLoading}
              >
                {forgotLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
                ) : (
                  <>Enviar Enlace de Recuperación</>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full gap-2"
                onClick={() => setShowForgot(false)}
              >
                <ArrowLeft className="w-4 h-4" /> Volver al inicio de sesión
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    )
  }

  // ---- (OLEADA 2) Segundo factor: canje del ticket por la sesión real ----
  if (mfaTicket) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-2xl border-0 rounded-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
        <CardHeader className="text-center pb-2 pt-6 px-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight">
            Verificación en dos pasos
          </CardTitle>
          <CardDescription className="text-slate-500 mt-1">
            {mfaRecoveryMode
              ? 'Ingresa uno de tus códigos de recuperación (un solo uso)'
              : 'Ingresa el código de 6 dígitos de tu app autenticadora'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-2">
          <form onSubmit={handleMfaSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 text-red-700 text-sm p-3.5 rounded-xl border border-red-200 flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {mfaRecoveryMode ? (
              <div className="space-y-2">
                <Label htmlFor="mfa-recovery" className="text-sm font-medium text-slate-700">
                  Código de recuperación
                </Label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="mfa-recovery"
                    type="text"
                    placeholder="XXXX-XXXX"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors font-mono uppercase"
                    required
                    autoComplete="off"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <InputOTP
                  maxLength={6}
                  value={mfaCode}
                  onChange={(v) => setMfaCode(v.replace(/\D/g, ''))}
                  autoFocus
                >
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
                <p className="text-xs text-slate-400">El código rota cada 30 segundos</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold h-11 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200"
              disabled={mfaLoading || mfaCode.trim().length < 6}
            >
              {mfaLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verificando...
                </>
              ) : (
                <>
                  Verificar
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>

            <button
              type="button"
              className="w-full text-xs text-slate-500 hover:text-slate-700 hover:underline"
              onClick={() => { setMfaRecoveryMode((v) => !v); setMfaCode(''); setError('') }}
            >
              {mfaRecoveryMode ? 'Usar código de la app autenticadora' : '¿Sin acceso a la app? Usa un código de recuperación'}
            </button>
            <Button
              type="button"
              variant="ghost"
              className="w-full gap-2"
              onClick={() => { setMfaTicket(null); setMfaCode(''); setError('') }}
            >
              <ArrowLeft className="w-4 h-4" /> Volver al inicio de sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md mx-auto shadow-2xl border-0 rounded-2xl overflow-hidden">
      {/* Header with gradient accent */}
      <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
      <CardHeader className="text-center pb-2 pt-6 px-8">
        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
          <span className="text-white font-bold text-2xl">A</span>
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight">
          Iniciar Sesión
        </CardTitle>
        <CardDescription className="text-slate-500 mt-1">
          Accede a tu cuenta de CRM ALBRA
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-2">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3.5 rounded-xl border border-red-200 flex items-start gap-2">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="login-email" className="text-sm font-medium text-slate-700">
              Correo Electrónico
            </Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="login-email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-sm font-medium text-slate-700">
                Contraseña
              </Label>
              <button
                type="button"
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium hover:underline"
                onClick={() => { setShowForgot(true); setForgotEmail(email) }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                required
                minLength={6}
                autoComplete="current-password"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold h-11 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Iniciando sesión...
              </>
            ) : (
              <>
                Iniciar Sesión
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center pb-6 pt-2 px-8">
        <p className="text-sm text-slate-500">
          ¿No tienes cuenta?{' '}
          <button
            type="button"
            onClick={() => setView('register')}
            className="text-emerald-600 hover:text-emerald-700 font-semibold hover:underline transition-colors"
          >
            Regístrate
          </button>
        </p>
      </CardFooter>
    </Card>
  )
}
