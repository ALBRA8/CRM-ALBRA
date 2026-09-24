'use client'

import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import { ArrowRight, Play, Users, TrendingUp, Heart } from 'lucide-react'

export function Hero() {
  const { setView } = useAppStore()

  return (
    <section className="relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE4YzAtOS45NC04LjA2LTE4LTE4LTE4UzAgOC4wNiAwIDE4czguMDYgMTggMTggMTggMTgtOC4wNiAxOC0xOHptMCAwYzAtOS45NC04LjA2LTE4LTE4LTE4UzAgOC4wNiAwIDE4czguMDYgMTggMTggMTggMTgtOC4wNiAxOC0xOHoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-30" />

      {/* Decorative circles */}
      <div className="absolute top-20 right-10 w-72 h-72 bg-emerald-400/20 rounded-full blur-3xl" />
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-teal-400/10 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-emerald-100 text-sm font-medium mb-6 border border-white/20">
              <span className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse" />
              Impulsado por Inteligencia Artificial
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white tracking-tight leading-tight"
          >
            Inteligencia Comercial{' '}
            <span className="text-emerald-200">que Trabaja por Ti</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 text-lg sm:text-xl text-emerald-100/90 max-w-2xl mx-auto leading-relaxed"
          >
            CRM con IA que captura prospectos, avanza oportunidades y fideliza clientes automáticamente. Tu agente comercial 24/7.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button
              size="lg"
              onClick={() => setView('register')}
              className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold px-8 py-6 text-base shadow-xl shadow-black/10 h-auto"
            >
              Comenzar Gratis
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setView('login')}
              className="border-white/30 text-white hover:bg-white/10 px-8 py-6 text-base h-auto"
            >
              <Play className="w-4 h-4 mr-2" />
              Iniciar Sesión
            </Button>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto"
          >
            <div className="text-center">
              <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-lg mx-auto mb-2">
                <Users className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">500+</p>
              <p className="text-sm text-emerald-200/80">empresas</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-lg mx-auto mb-2">
                <TrendingUp className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">50K+</p>
              <p className="text-sm text-emerald-200/80">clientes gestionados</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-lg mx-auto mb-2">
                <Heart className="w-5 h-5 text-emerald-200" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-white">98%</p>
              <p className="text-sm text-emerald-200/80">satisfacción</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom wave */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 60V30C240 0 480 0 720 30C960 60 1200 60 1440 30V60H0Z" fill="white" />
        </svg>
      </div>
    </section>
  )
}
