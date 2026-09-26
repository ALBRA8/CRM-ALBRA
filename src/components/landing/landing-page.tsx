'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { LoginForm } from '@/components/auth/login-form'
import { RegisterForm } from '@/components/auth/register-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
  Sparkles,
} from 'lucide-react'
import { api } from '@/lib/api'
import { LegalDialog, type LegalDoc } from './legal-dialog'

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
      <span>{loading ? 'Preparando tu demo...' : 'INICIAR DEMO'}</span>
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
            initial={{ opacity: 1, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-emerald-100 text-sm font-medium mb-8 border border-white/20">
              <span className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse" />
              Impulsado por Inteligencia Artificial
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 1, y: 20 }}
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
            initial={{ opacity: 1, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-7 text-lg sm:text-xl text-emerald-100/90 max-w-2xl mx-auto leading-relaxed"
          >
            CRM con IA que captura prospectos, avanza oportunidades y fideliza clientes automáticamente. Tu agente comercial que nunca duerme.
          </motion.p>

          <motion.div
            initial={{ opacity: 1, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col items-center gap-4"
          >
            {/* INICIAR DEMO - Main CTA (demo gratuita con datos de ejemplo) */}
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

          {/* Stats — solo datos verificables en el producto (14 módulos = nav del sidebar;
              3 canales = integraciones WhatsApp/Telegram/Instagram) + estado honesto de la beta */}
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-20 grid grid-cols-3 gap-6 sm:gap-10 max-w-xl mx-auto"
          >
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <Users className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">14</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">módulos completos</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <TrendingUp className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">3</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">WhatsApp · Telegram · Instagram</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-11 h-11 bg-white/10 rounded-xl mx-auto mb-3 backdrop-blur-sm border border-white/10">
                <Heart className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">1</p>
              <p className="text-xs sm:text-sm text-emerald-200/80 mt-0.5">empresa por vez — beta privada</p>
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
      'Sistema de reservas con recordatorios automáticos para ti y para tus clientes.',
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
      'La IA analiza cada cliente y te sugiere cuándo y por qué contactarlo hoy.',
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
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
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
                initial={{ opacity: 1, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
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

/* ──────────────── How It Works Section ──────────────── */
const steps = [
  {
    n: 1,
    title: 'Conecta tus canales',
    description:
      'Vincula WhatsApp (vía QR o Cloud API), Telegram, Instagram y Google Workspace. El agente IA empieza a responder automáticamente.',
    icon: Bot,
  },
  {
    n: 2,
    title: 'Captura y califica leads',
    description:
      'Cada mensaje entrante genera un cliente, lo asocia a una oportunidad y lo califica con score y temperatura. El pipeline se actualiza solo.',
    icon: TrendingUp,
  },
  {
    n: 3,
    title: 'Cierra y fideliza',
    description:
      'Cotizaciones en PDF, recordatorios automáticos, scoring continuo y notificaciones push al celular cuando se requiere atención humana.',
    icon: Check,
  },
]

function HowItWorksSection() {
  return (
    <section className="py-20 sm:py-28 bg-white" id="como-funciona">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              <Zap className="w-4 h-4" />
              Cómo funciona
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              De mensaje a venta en tres pasos
            </h2>
            <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Sin configuraciones complejas. Conectas tus canales, el agente aprende
              tu rubro durante el piloto y empieza a responder por ti.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <motion.div
                key={step.n}
                initial={{ opacity: 1, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
                transition={{ duration: 0.4, delay: index * 0.12 }}
                className="relative"
              >
                {/* Conector visual */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-[60%] w-full h-px bg-gradient-to-r from-emerald-200 to-slate-200" />
                )}

                <div className="relative bg-white rounded-2xl p-7 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-emerald-600" />
                    </div>
                    <span className="text-5xl font-extrabold text-slate-100 leading-none">
                      {step.n}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">
                    {step.title}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ──────────────── Pricing Section (beta privada — piloto controlado, sin precios inventados) ──────────────── */
const pilotFeatures = [
  'CRM completo: los 14 módulos, del pipeline a las finanzas',
  'Agente de IA configurado a tu rubro',
  'Acompañamiento de implementación de principio a fin',
  'Datos aislados por organización',
  'WhatsApp, Telegram e Instagram conectados',
  'Cotizaciones en PDF, reportes y recordatorios automáticos',
]

const comingSoon = [
  {
    name: 'Acceso para equipos',
    description:
      'Abriremos más cupos cuando el piloto actual demuestre estabilidad operando en un negocio real.',
  },
  {
    name: 'Planes y precios',
    description:
      'El modelo de precios se definirá con la retroalimentación del piloto. Nada se cobra automáticamente.',
  },
]

function PricingSection() {
  const { setView } = useAppStore()

  return (
    <section className="py-20 sm:py-28 bg-slate-50" id="pricing">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              Beta privada
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight">
              Piloto controlado, una empresa a la vez
            </h2>
            <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Estamos en beta privada: abrimos un cupo por vez para acompañar la
              implementación de cerca. Puedes probar la demo gratis ahora o solicitar
              el cupo del piloto.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto items-stretch">
          {/* Card destacada: Piloto controlado */}
          <motion.div
            initial={{ opacity: 1, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
            transition={{ duration: 0.4 }}
            whileHover={{ y: -6 }}
            className="relative rounded-2xl p-8 transition-all duration-300 bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-2xl shadow-emerald-600/30 md:scale-105 border-0 flex flex-col"
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-amber-900 text-xs font-bold rounded-full shadow-lg shadow-amber-400/30 uppercase tracking-wider">
              Cupo abierto
            </div>

            <h3 className="text-xl font-bold text-white mt-2">Piloto controlado</h3>
            <p className="text-sm mt-1.5 text-emerald-100">
              Una empresa a la vez, con acompañamiento de principio a fin.
            </p>

            <div className="mt-7 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight text-white">1 empresa</span>
              <span className="text-lg font-medium text-emerald-200">por vez</span>
            </div>
            <p className="text-xs text-emerald-100/80 mt-2">
              Beta privada — plazas limitadas. La demo es gratis; el alcance del piloto se
              acuerda contigo.
            </p>

            <ul className="mt-8 space-y-3.5">
              {pilotFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-white/20">
                    <Check className="w-3 h-3 text-emerald-100" strokeWidth={3} />
                  </div>
                  <span className="text-sm leading-relaxed text-emerald-50">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-9 space-y-3">
              <a
                href="mailto:contacto@crm-albra.com?subject=Cupo%20en%20la%20beta%20-%20CRM%20ALBRA"
                className="w-full inline-flex items-center justify-center gap-2 bg-white text-emerald-700 font-semibold h-12 rounded-xl transition-all duration-200 hover:bg-emerald-50 hover:scale-[1.02] shadow-lg shadow-black/10"
              >
                Solicitar cupo en la beta
                <ArrowRight className="w-4 h-4" />
              </a>
              <Button
                onClick={() => setView('register')}
                className="w-full font-semibold h-11 rounded-xl transition-all duration-200 bg-white/10 border border-white/30 text-white hover:bg-white/20"
                size="lg"
              >
                Empezar gratis la demo
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>

          {/* Estados "Próximamente" — sin precios ni promesas */}
          {comingSoon.map((item, index) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 1, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
              transition={{ duration: 0.4, delay: (index + 1) * 0.1 }}
              className="relative rounded-2xl p-8 transition-all duration-300 bg-white border border-dashed border-slate-300 text-slate-500 shadow-sm flex flex-col"
            >
              <span className="self-start px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                Próximamente
              </span>

              <h3 className="text-xl font-bold text-slate-700 mt-6">{item.name}</h3>
              <p className="text-sm mt-2 leading-relaxed text-slate-500 flex-1">
                {item.description}
              </p>

              <p className="text-xs text-slate-400 mt-6">
                Disponible después del piloto actual.
              </p>
            </motion.div>
          ))}
        </div>

        {/* Aviso legal honesto */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.1, margin: "0px 0px -200px 0px" }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-12 text-center max-w-2xl mx-auto text-xs text-slate-400 leading-relaxed"
        >
          CRM ALBRA es un producto en beta privada y se ofrece como software
          instalable. El procesamiento de datos personales (teléfonos, nombres,
          conversaciones) es responsabilidad del operador del sistema, quien
          debe cumplir con la normativa local de protección de datos — Ley 1581
          de 2012 en Colombia — y los términos de servicio de WhatsApp, Telegram
          y Google. Consulta la Política de Privacidad y los Términos en el pie
          de página.
        </motion.p>
      </div>
    </section>
  )
}

/* ──────────────── Footer ──────────────── */
function Footer({ onOpenLegal }: { onOpenLegal: (doc: LegalDoc) => void }) {
  const { setView } = useAppStore()
  const year = new Date().getFullYear()
  const linkClass = 'text-left hover:text-emerald-400 cursor-pointer transition-colors'

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
            <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-emerald-400">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              Beta privada — 1 empresa por vez
            </p>
          </div>

          {/* Producto (solo enlaces que existen) */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Producto</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li><a href="#features" className={linkClass}>Funciones</a></li>
              <li><a href="#como-funciona" className={linkClass}>Cómo funciona</a></li>
              <li><a href="#pricing" className={linkClass}>Piloto controlado</a></li>
              <li>
                <button onClick={() => setView('register')} className={linkClass}>
                  Crear cuenta demo
                </button>
              </li>
            </ul>
          </div>

          {/* Beta (estado real del proyecto) */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Beta</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li>Estado: beta privada</li>
              <li>Cupos: 1 empresa por vez</li>
              <li>
                <a href="mailto:contacto@crm-albra.com" className={linkClass}>
                  contacto@crm-albra.com
                </a>
              </li>
            </ul>
          </div>

          {/* Legal (abre resúmenes en dialog) */}
          <div>
            <h4 className="font-semibold text-sm mb-5 text-slate-200">Legal</h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li>
                <button onClick={() => onOpenLegal('privacidad')} className={linkClass}>
                  Política de Privacidad
                </button>
              </li>
              <li>
                <button onClick={() => onOpenLegal('terminos')} className={linkClass}>
                  Términos de Servicio
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            © {year} CRM ALBRA · Beta privada. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <button onClick={() => onOpenLegal('privacidad')} className="hover:text-emerald-400 cursor-pointer transition-colors">
              Privacidad
            </button>
            <button onClick={() => onOpenLegal('terminos')} className="hover:text-emerald-400 cursor-pointer transition-colors">
              Términos
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}

/* ──────────────── Main Landing Page ──────────────── */
export function LandingPage() {
  const { view, setView } = useAppStore()
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)

  const showLogin = view === 'login'
  const showRegister = view === 'register'

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Legal Dialog (Términos y Privacidad) */}
      <LegalDialog doc={legalDoc} onOpenChange={(open) => !open && setLegalDoc(null)} />

      {/* Login Dialog */}
      <Dialog open={showLogin} onOpenChange={(open) => !open && setView('landing')}>
        <DialogContent className="sm:max-w-md p-0 border-0 overflow-hidden rounded-2xl bg-transparent shadow-none">
          <DialogTitle className="sr-only">Iniciar Sesión</DialogTitle>
          <DialogDescription className="sr-only">Accede a tu cuenta de CRM ALBRA</DialogDescription>
          <LoginForm />
        </DialogContent>
      </Dialog>

      {/* Register Dialog */}
      <Dialog open={showRegister} onOpenChange={(open) => !open && setView('landing')}>
        <DialogContent className="sm:max-w-md p-0 border-0 overflow-hidden rounded-2xl bg-transparent shadow-none">
          <DialogTitle className="sr-only">Crear Cuenta</DialogTitle>
          <DialogDescription className="sr-only">Regístrate gratis en CRM ALBRA</DialogDescription>
          <RegisterForm />
        </DialogContent>
      </Dialog>

      {/* Hero */}
      <div className="pt-16">
        <HeroSection />
      </div>

      {/* Features */}
      <FeaturesSection />

      {/* How It Works */}
      <HowItWorksSection />

      {/* Pricing */}
      <PricingSection />

      {/* Footer */}
      <Footer onOpenLegal={setLegalDoc} />
    </div>
  )
}
