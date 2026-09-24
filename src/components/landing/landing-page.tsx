'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { LoginForm } from '@/components/auth/login-form'
import { RegisterForm } from '@/components/auth/register-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Play,
  Users,
  TrendingUp,
  Heart,
  Bot,
  BarChart3,
  CalendarClock,
  UserCircle,
  Zap,
  Lightbulb,
  Check,
  Menu,
  X,
  ChevronRight,
  Rocket,
  Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'

/* ──────────────── Demo Start Button ──────────────── */
function DemoStartButton() {
  const { setToken, setUser, setView } = useAppStore()
  const [loading, setLoading] = useState(false)

  const handleDemoStart = async () => {
    setLoading(true)
    try {
      const data = await api.demoLogin()
      const token = data.token
      setToken(token)
      api.setToken(token)
      localStorage.setItem('crm_token', token)
      setUser(data.user)
      setView('dashboard')
    } catch (error) {
      console.error('Demo login error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleDemoStart}
      disabled={loading}
      className="group relative inline-flex items-center gap-3 bg-white text-emerald-700 font-bold px-10 py-5 text-lg shadow-2xl shadow-black/20 h-auto rounded-2xl transition-all duration-300 hover:scale-[1.03] hover:shadow-black/30 disabled:opacity-70 disabled:cursor-not-allowed"
    >
      {/* Glow effect behind */}
      <div className="absolute -inset-1 bg-gradient-to-r from-emerald-400 to-teal-400 rounded-2xl opacity-30 blur-md group-hover:opacity-50 transition-opacity duration-300 -z-10" />

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin" />
      ) : (
        <Rocket className="w-6 h-6 group-hover:rotate-12 transition-transform duration-300" />
      )}
      <span>{loading ? 'Preparando tu demo...' : 'INICIAR'}</span>
      {!loading && <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />}
    </button>
  )
}

/* ──────────────── Navbar ──────────────── */
function Navbar() {
  const { setView } = useAppStore()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-lg shadow-lg shadow-slate-900/5'
          : 'bg-white/70 backdrop-blur-md'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-500/20">
              <span className="text-white font-bold text-base">A</span>
            </div>
            <span className="font-bold text-xl tracking-tight">
              <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                CRM ALBRA
              </span>
            </span>
          </div>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              Funciones
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors"
            >
              Precios
            </a>
          </div>

          {/* Desktop Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => setView('login')}
              className="text-sm font-medium text-slate-600 hover:text-emerald-600 hover:bg-emerald-50"
            >
              Iniciar Sesión
            </Button>
            <Button
              onClick={() => setView('register')}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-semibold shadow-md shadow-emerald-500/25 rounded-xl px-5"
            >
              Comenzar Gratis
            </Button>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5 text-slate-700" /> : <Menu className="w-5 h-5 text-slate-700" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="md:hidden bg-white border-t border-slate-100 shadow-lg"
        >
          <div className="px-4 py-4 space-y-3">
            <a
              href="#features"
              className="block px-3 py-2 text-sm font-medium text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              Funciones
            </a>
            <a
              href="#pricing"
              className="block px-3 py-2 text-sm font-medium text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              Precios
            </a>
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <Button
                variant="outline"
                onClick={() => { setView('login'); setMobileOpen(false) }}
                className="w-full rounded-xl"
              >
                Iniciar Sesión
              </Button>
              <Button
                onClick={() => { setView('register'); setMobileOpen(false) }}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold shadow-md shadow-emerald-500/25 rounded-xl"
              >
                Comenzar Gratis
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </nav>
  )
}

/* ──────────────── Hero Section ──────────────── */
function HeroSection() {
  const { setView } = useAppStore()

  return (
    <section className="relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-800" />

      {/* Animated pattern overlay */}
      <div className="absolute inset-0 opacity-[0.07]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 75%, white 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Decorative blurs */}
      <div className="absolute top-20 right-0 w-[500px] h-[500px] bg-emerald-400/20 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-emerald-300/10 rounded-full blur-[80px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-28 sm:py-36 lg:py-44">
        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-emerald-100 text-sm font-medium mb-8 border border-white/20">
              <span className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse" />
              Impulsado por Inteligencia Artificial
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.1]"
          >
            Inteligencia Comercial{' '}
            <span className="bg-gradient-to-r from-emerald-200 to-teal-200 bg-clip-text text-transparent">
              que Trabaja por Ti
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-7 text-lg sm:text-xl text-emerald-100/90 max-w-2xl mx-auto leading-relaxed"
          >
            CRM con IA que captura prospectos, avanza oportunidades y fideliza clientes automáticamente. Tu agente comercial que nunca duerme.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col items-center gap-4"
          >
            {/* INICIAR - Main CTA */}
            <DemoStartButton />

            <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
              <Button
                size="lg"
                onClick={() => setView('register')}
                className="bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 font-semibold px-8 py-5 text-sm shadow-lg h-auto rounded-xl transition-all duration-200 hover:scale-[1.02]"
              >
                Crear Cuenta
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setView('login')}
                className="border-white/30 text-white hover:bg-white/10 px-8 py-5 text-sm h-auto rounded-xl backdrop-blur-sm"
              >
                <Play className="w-4 h-4 mr-2" />
                Iniciar Sesión
              </Button>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-20 grid grid-cols-3 gap-6 sm:gap-10 max-w-xl mx-auto"
          >
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <Users className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">500+</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">empresas confían</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <TrendingUp className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">50K+</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">clientes gestionados</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <Heart className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">98%</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">satisfacción</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom wave */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
          <path
            d="M0 80V40C240 10 480 0 720 20C960 40 1200 60 1440 30V80H0Z"
            fill="white"
          />
        </svg>
      </div>
    </section>
  )
}

/* ──────────────── Features Section ──────────────── */
const features = [
  {
    icon: Bot,
    title: 'Agente IA Integrado',
    description:
      'Chat inteligente que captura y califica leads automáticamente, avanzándolos en el pipeline sin intervención manual.',
    color: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    borderColor: 'border-emerald-100',
    hoverBorder: 'hover:border-emerald-200',
  },
  {
    icon: BarChart3,
    title: 'Pipeline Visual',
    description:
      'Seguimiento de oportunidades en tiempo real con vista Kanban. Visualiza tu embudo de ventas de un vistazo.',
    color: 'bg-teal-50',
    iconColor: 'text-teal-600',
    borderColor: 'border-teal-100',
    hoverBorder: 'hover:border-teal-200',
  },
  {
    icon: CalendarClock,
    title: 'Calendario Inteligente',
    description:
      'Sistema de reservas con recordatorios automáticos. Nunca más pierdas una cita o un cliente.',
    color: 'bg-amber-50',
    iconColor: 'text-amber-600',
    borderColor: 'border-amber-100',
    hoverBorder: 'hover:border-amber-200',
  },
  {
    icon: UserCircle,
    title: 'Ficha de Cliente 360°',
    description:
      'Historial completo de servicios, preferencias, frecuencia de contacto y temperatura del lead.',
    color: 'bg-rose-50',
    iconColor: 'text-rose-600',
    borderColor: 'border-rose-100',
    hoverBorder: 'hover:border-rose-200',
  },
  {
    icon: Zap,
    title: 'Automatizaciones',
    description:
      'Recordatorios de citas, recuperación de clientes inactivos y campañas de fidelización en piloto automático.',
    color: 'bg-violet-50',
    iconColor: 'text-violet-600',
    borderColor: 'border-violet-100',
    hoverBorder: 'hover:border-violet-200',
  },
  {
    icon: Lightbulb,
    title: 'Sugerencias Inteligentes',
    description:
      'La IA analiza cada cliente y te dice exactamente cuándo y por qué contactarlo hoy.',
    color: 'bg-sky-50',
    iconColor: 'text-sky-600',
    borderColor: 'border-sky-100',
    hoverBorder: 'hover:border-sky-200',
  },
]

function FeaturesSection() {
  return (
    <section className="py-20 sm:py-28 bg-white" id="features">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              <ChevronRight className="w-4 h-4" />
              Funcionalidades
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight">
              Todo lo que Necesitas para Crecer
            </h2>
            <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Un CRM completo con inteligencia artificial que automatiza lo repetitivo y te enfoca en lo que importa: cerrar ventas.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                whileHover={{ scale: 1.03, y: -4 }}
                className={`group p-7 rounded-2xl border ${feature.borderColor} ${feature.hoverBorder} bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 cursor-default`}
              >
                <div
                  className={`w-14 h-14 rounded-2xl ${feature.color} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}
                >
                  <Icon className={`w-7 h-7 ${feature.iconColor}`} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2.5">{feature.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ──────────────── Pricing Section ──────────────── */
const plans = [
  {
    name: 'Starter',
    price: '$29',
    period: '/mes',
    description: 'Para emprendedores que inician',
    features: [
      '1 usuario',
      '100 clientes',
      '3 automatizaciones',
      'Chat IA básico',
      'Pipeline básico',
      'Soporte por email',
    ],
    cta: 'Comenzar Gratis',
    popular: false,
  },
  {
    name: 'Professional',
    price: '$79',
    period: '/mes',
    description: 'Más Popular',
    features: [
      '5 usuarios',
      'Clientes ilimitados',
      'IA avanzada',
      'Automatizaciones ilimitadas',
      'Cotizaciones profesionales',
      'Pipeline personalizable',
      'Sugerencias inteligentes',
      'Soporte prioritario',
    ],
    cta: 'Comenzar Gratis',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: '$199',
    period: '/mes',
    description: 'Para equipos grandes',
    features: [
      'Usuarios ilimitados',
      'Todo en Professional',
      'API personalizada',
      'Integraciones avanzadas',
      'Soporte prioritario 24/7',
      'Onboarding dedicado',
      'SLA garantizado',
    ],
    cta: 'Contactar Ventas',
    popular: false,
  },
]

function PricingSection() {
  const { setView } = useAppStore()

  return (
    <section className="py-20 sm:py-28 bg-slate-50" id="pricing">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              <ChevronRight className="w-4 h-4" />
              Precios
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight">
              Planes que Crecen Contigo
            </h2>
            <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Comienza gratis y escala según creces. Sin sorpresas ni costos ocultos.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto items-start">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              whileHover={{ y: -6 }}
              className={`relative rounded-2xl p-8 transition-all duration-300 ${
                plan.popular
                  ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-2xl shadow-emerald-600/30 md:scale-105 border-0'
                  : 'bg-white border border-slate-200 shadow-sm hover:shadow-lg hover:border-slate-300'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-amber-900 text-xs font-bold rounded-full shadow-lg shadow-amber-400/30 uppercase tracking-wider">
                  Más Popular
                </div>
              )}

              <h3
                className={`text-xl font-bold ${plan.popular ? 'text-white' : 'text-slate-900'}`}
              >
                {plan.name}
              </h3>
              <p
                className={`text-sm mt-1.5 ${plan.popular ? 'text-emerald-100' : 'text-slate-500'}`}
              >
                {plan.description}
              </p>

              <div className="mt-7 flex items-baseline gap-1">
                <span
                  className={`text-5xl font-extrabold tracking-tight ${
                    plan.popular ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {plan.price}
                </span>
                <span
                  className={`text-lg font-medium ${
                    plan.popular ? 'text-emerald-200' : 'text-slate-400'
                  }`}
                >
                  {plan.period}
                </span>
              </div>

              <ul className="mt-8 space-y-3.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        plan.popular ? 'bg-white/20' : 'bg-emerald-50'
                      }`}
                    >
                      <Check
                        className={`w-3 h-3 ${plan.popular ? 'text-emerald-100' : 'text-emerald-600'}`}
                        strokeWidth={3}
                      />
                    </div>
                    <span
                      className={`text-sm leading-relaxed ${
                        plan.popular ? 'text-emerald-50' : 'text-slate-600'
                      }`}
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => setView('register')}
                className={`w-full mt-9 font-semibold h-12 rounded-xl transition-all duration-200 ${
                  plan.popular
                    ? 'bg-white text-emerald-700 hover:bg-emerald-50 shadow-lg shadow-black/10 hover:scale-[1.02]'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20 hover:scale-[1.02]'
                }`}
                size="lg"
              >
                {plan.cta}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ──────────────── Footer ──────────────── */
function Footer() {
  return (
    <footer className="bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand Column */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <span className="text-white font-bold text-base">A</span>
              </div>
              <span className="font-bold text-xl tracking-tight">CRM ALBRA</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
              Inteligencia comercial que trabaja por ti. Automatiza la captura de prospectos, avanza oportunidades y fideliza clientes con IA.
            </p>
          </div>

          {/* Producto */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Producto</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Funciones</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Precios</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Integraciones</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Changelog</li>
            </ul>
          </div>

          {/* Empresa */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Empresa</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Nosotros</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Blog</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Carreras</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Contacto</li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Legal</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Privacidad</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Términos de Servicio</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Cookies</li>
              <li className="hover:text-emerald-400 cursor-pointer transition-colors">Seguridad</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            © 2024 CRM ALBRA. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <span className="hover:text-emerald-400 cursor-pointer transition-colors">Privacidad</span>
            <span className="hover:text-emerald-400 cursor-pointer transition-colors">Términos</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

/* ──────────────── Main Landing Page ──────────────── */
export function LandingPage() {
  const { view, setView } = useAppStore()

  const showLogin = view === 'login'
  const showRegister = view === 'register'

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Login Dialog */}
      <Dialog open={showLogin} onOpenChange={(open) => !open && setView('landing')}>
        <DialogContent className="sm:max-w-md p-0 border-0 overflow-hidden rounded-2xl bg-transparent shadow-none">
          <LoginForm />
        </DialogContent>
      </Dialog>

      {/* Register Dialog */}
      <Dialog open={showRegister} onOpenChange={(open) => !open && setView('landing')}>
        <DialogContent className="sm:max-w-md p-0 border-0 overflow-hidden rounded-2xl bg-transparent shadow-none">
          <RegisterForm />
        </DialogContent>
      </Dialog>

      {/* Hero */}
      <div className="pt-16">
        <HeroSection />
      </div>

      {/* Features */}
      <FeaturesSection />

      {/* Pricing */}
      <PricingSection />

      {/* Footer */}
      <Footer />
    </div>
  )
}
