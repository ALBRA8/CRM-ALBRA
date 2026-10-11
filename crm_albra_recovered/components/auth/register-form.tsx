'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Mail, Lock, User, Building2, Phone, ArrowRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

export function RegisterForm() {
  const { setView, setUser, setToken } = useAppStore()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    company: '',
    phone: '',
  })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!acceptTerms) {
      setError('Debes aceptar los términos y condiciones')
      toast.error('Debes aceptar los términos y condiciones')
      return
    }

    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }

    setLoading(true)

    try {
      const data = await api.register({
        name: form.name,
        email: form.email,
        password: form.password,
        company: form.company || undefined,
        phone: form.phone || undefined,
      })
      localStorage.setItem('crm_token', data.token)
      setToken(data.token)
      setUser(data.user as { id: string; name: string; email: string; company?: string | null; phone?: string | null; role: string; avatar?: string | null })
      api.setToken(data.token)
      setView('dashboard')
      toast.success('¡Cuenta creada exitosamente! Bienvenido a CRM ALBRA')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al crear cuenta'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto shadow-2xl border-0 rounded-2xl overflow-hidden">
      {/* Header with gradient accent */}
      <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
      <CardHeader className="text-center pb-2 pt-6 px-8">
        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
          <Sparkles className="w-7 h-7 text-white" />
        </div>
        <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight">
          Crear Cuenta
        </CardTitle>
        <CardDescription className="text-slate-500 mt-1">
          Empieza tu prueba gratuita de CRM ALBRA
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-2">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3.5 rounded-xl border border-red-200 flex items-start gap-2">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reg-name" className="text-sm font-medium text-slate-700">
              Nombre Completo <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="reg-name"
                placeholder="Tu nombre completo"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                required
                autoComplete="name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-email" className="text-sm font-medium text-slate-700">
              Correo Electrónico <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="reg-email"
                type="email"
                placeholder="tu@email.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-password" className="text-sm font-medium text-slate-700">
              Contraseña <span className="text-red-400">*</span>
            </Label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="reg-password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="reg-company" className="text-sm font-medium text-slate-700">
                Empresa
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="reg-company"
                  placeholder="Tu empresa"
                  value={form.company}
                  onChange={(e) => updateField('company', e.target.value)}
                  className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                  autoComplete="organization"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-phone" className="text-sm font-medium text-slate-700">
                Teléfono
              </Label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="reg-phone"
                  placeholder="+52 123 456"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-colors"
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 pt-1">
            <Checkbox
              id="terms"
              checked={acceptTerms}
              onCheckedChange={(checked) => setAcceptTerms(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="terms" className="text-xs text-slate-500 leading-relaxed cursor-pointer">
              Acepto los{' '}
              <span className="text-emerald-600 hover:underline font-medium">Términos de Servicio</span>
              {' '}y la{' '}
              <span className="text-emerald-600 hover:underline font-medium">Política de Privacidad</span>
            </Label>
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold h-11 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creando cuenta...
              </>
            ) : (
              <>
                Crear Cuenta Gratis
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center pb-6 pt-2 px-8">
        <p className="text-sm text-slate-500">
          ¿Ya tienes cuenta?{' '}
          <button
            type="button"
            onClick={() => setView('login')}
            className="text-emerald-600 hover:text-emerald-700 font-semibold hover:underline transition-colors"
          >
            Inicia sesión
          </button>
        </p>
      </CardFooter>
    </Card>
  )
}
