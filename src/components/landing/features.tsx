'use client'

import { motion } from 'framer-motion'
import { Bot, TrendingUp, CalendarClock, UserCircle, Zap, Lightbulb } from 'lucide-react'

const features = [
  {
    icon: Bot,
    title: 'Agente IA Integrado',
    description: 'Chat inteligente que captura y califica leads automáticamente, respondiendo consultas 24/7.',
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: TrendingUp,
    title: 'Pipeline Visual',
    description: 'Seguimiento de oportunidades en tiempo real con etapas personalizables y métricas claras.',
    color: 'bg-teal-50 text-teal-600',
  },
  {
    icon: CalendarClock,
    title: 'Calendario Inteligente',
    description: 'Reservas con recordatorios automáticos y prevención de citas duplicadas.',
    color: 'bg-amber-50 text-amber-600',
  },
  {
    icon: UserCircle,
    title: 'Ficha de Cliente 360°',
    description: 'Historial completo, preferencias, frecuencia de compra y temperatura del lead.',
    color: 'bg-rose-50 text-rose-600',
  },
  {
    icon: Zap,
    title: 'Automatizaciones',
    description: 'Recordatorios, recuperación de inactivos y fidelización automática por reglas.',
    color: 'bg-violet-50 text-violet-600',
  },
  {
    icon: Lightbulb,
    title: 'Sugerencias Inteligentes',
    description: 'IA que te dice cuándo contactar cada cliente y qué acción tomar para cerrar más ventas.',
    color: 'bg-sky-50 text-sky-600',
  },
]

export function Features() {
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
            <span className="text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              Funcionalidades
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Todo lo que necesitas para vender más
            </h2>
            <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
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
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className="p-6 rounded-xl border border-slate-200 bg-white hover:shadow-lg transition-shadow"
              >
                <div className={`w-12 h-12 rounded-lg ${feature.color} flex items-center justify-center mb-4`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
