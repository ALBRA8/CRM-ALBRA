'use client'

import { useAppStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

const plans = [
  {
    name: 'Starter',
    price: '$29',
    period: '/mes',
    description: 'Perfecto para emprendedores que inician',
    features: [
      '1 usuario',
      '100 clientes',
      '3 automatizaciones',
      'Pipeline básico',
      'Calendario',
      'Soporte por email',
    ],
    cta: 'Comenzar Gratis',
    popular: false,
  },
  {
    name: 'Professional',
    price: '$79',
    period: '/mes',
    description: 'Para equipos que quieren crecer con IA',
    features: [
      '5 usuarios',
      'Clientes ilimitados',
      'Automatizaciones ilimitadas',
      'IA avanzada (agente chat)',
      'Pipeline personalizable',
      'Cotizaciones profesionales',
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
    description: 'Para organizaciones que necesitan todo',
    features: [
      'Usuarios ilimitados',
      'Todo en Professional',
      'API personalizada',
      'Integraciones avanzadas',
      'Memoria del agente IA',
      'Reportes avanzados',
      'Onboarding dedicado',
      'SLA garantizado',
    ],
    cta: 'Contactar Ventas',
    popular: false,
  },
]

export function Pricing() {
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
            <span className="text-emerald-600 font-semibold text-sm uppercase tracking-wider">
              Precios
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Planes que crecen contigo
            </h2>
            <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
              Comienza gratis y escala según creces. Sin sorpresas ni costos ocultos.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className={`relative rounded-2xl p-8 ${
                plan.popular
                  ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-600/20 scale-105 border-0'
                  : 'bg-white border border-slate-200 shadow-sm'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-amber-400 text-amber-900 text-xs font-bold rounded-full">
                  MÁS POPULAR
                </div>
              )}

              <h3 className={`text-xl font-bold ${plan.popular ? 'text-white' : 'text-slate-900'}`}>
                {plan.name}
              </h3>
              <p className={`text-sm mt-1 ${plan.popular ? 'text-emerald-100' : 'text-slate-500'}`}>
                {plan.description}
              </p>

              <div className="mt-6 flex items-baseline">
                <span className={`text-4xl font-bold ${plan.popular ? 'text-white' : 'text-slate-900'}`}>
                  {plan.price}
                </span>
                <span className={`text-lg ${plan.popular ? 'text-emerald-200' : 'text-slate-400'}`}>
                  {plan.period}
                </span>
              </div>

              <ul className="mt-8 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className={`w-5 h-5 flex-shrink-0 ${plan.popular ? 'text-emerald-200' : 'text-emerald-500'}`} />
                    <span className={`text-sm ${plan.popular ? 'text-emerald-50' : 'text-slate-600'}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => setView('register')}
                className={`w-full mt-8 font-medium ${
                  plan.popular
                    ? 'bg-white text-emerald-700 hover:bg-emerald-50'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
                size="lg"
              >
                {plan.cta}
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
