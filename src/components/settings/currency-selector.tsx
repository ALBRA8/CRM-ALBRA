'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DollarSign, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  CURRENCIES,
  getActiveCurrency,
  setActiveCurrency,
  subscribeCurrency,
  type CurrencyCode,
} from '@/lib/currency'

export function CurrencySelector() {
  const [currency, setCurrency] = useState<CurrencyCode>(getActiveCurrency())

  useEffect(() => {
    const unsub = subscribeCurrency(() => {
      setCurrency(getActiveCurrency())
    })
    return unsub
  }, [])

  const handleChange = (value: string) => {
    const code = value as CurrencyCode
    setActiveCurrency(code)
    setCurrency(code)
    toast.success('Moneda actualizada', {
      description: `Los montos ahora se muestran en ${CURRENCIES[code].label}`,
    })
  }

  const activeInfo = CURRENCIES[currency]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/50 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Moneda del Negocio</CardTitle>
              <CardDescription>Define la moneda principal para facturación y reportes</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Moneda Activa</Label>
            <Select value={currency} onValueChange={handleChange}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Selecciona una moneda" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CURRENCIES).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs w-10">{c.code}</span>
                      <span>{c.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400">
              Todos los montos del CRM (dashboard, reportes, cotizaciones) se mostrarán en esta moneda.
            </p>
          </div>

          <div className="flex items-center gap-2 p-3 bg-emerald-50/50 dark:bg-emerald-950/40 rounded-lg border border-emerald-100 dark:border-emerald-900">
            <div className="w-7 h-7 bg-emerald-100 dark:bg-emerald-900/70 rounded-full flex items-center justify-center flex-shrink-0">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-emerald-900 dark:text-emerald-100">
                Vista previa: <span className="font-mono">{activeInfo.code}</span>
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                1,234.56 se muestra como: <strong>{new Intl.NumberFormat(activeInfo.locale, { style: 'currency', currency: activeInfo.code }).format(1234.56)}</strong>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
