'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkles, Phone, ArrowRight } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Suggestion {
  client: {
    id: string
    name: string
    phone: string
    email?: string
    temperature: string
    score: number
    lastContactAt?: string | null
    daysSinceContact: number
    latestOpportunity?: { id: string; title: string; stage: string; estimatedValue: number } | null
    upcomingReservation?: { id: string; title: string; date: string } | null
  }
  priorityScore: number
  reasons: string[]
}

const tempColors: Record<string, string> = {
  Frio: 'bg-slate-100 text-slate-600',
  Tibio: 'bg-amber-50 text-amber-700',
  Caliente: 'bg-orange-50 text-orange-700',
  Fuego: 'bg-red-50 text-red-700',
}

export function SuggestionsPanel() {
  const { setView, setSelectedClientId } = useAppStore()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSuggestions()
  }, [])

  const loadSuggestions = async () => {
    try {
      const data = await api.getSuggestions()
      setSuggestions((data.suggestions as Suggestion[]) ?? [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  const handleContact = (clientId: string) => {
    setSelectedClientId(clientId)
    setView('client-detail')
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          Sugerencias IA
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : suggestions.length > 0 ? (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {suggestions.slice(0, 10).map((sug, index) => (
              <div
                key={sug.client.id}
                className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                onClick={() => handleContact(sug.client.id)}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-600 w-5">#{index + 1}</span>
                    <p className="text-sm font-medium text-slate-900">{sug.client.name}</p>
                  </div>
                  <Badge className={`text-[10px] ${tempColors[sug.client.temperature] ?? ''}`}>
                    {sug.client.temperature}
                  </Badge>
                </div>
                <div className="ml-7">
                  {sug.reasons.slice(0, 2).map((reason, i) => (
                    <p key={i} className="text-xs text-slate-500 flex items-center gap-1">
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      {reason}
                    </p>
                  ))}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px]">
                      Score: {sug.priorityScore}
                    </Badge>
                    <span className="text-[10px] text-slate-400">
                      {sug.client.daysSinceContact}d sin contacto
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400 text-sm">
            No hay sugerencias disponibles
          </div>
        )}
      </CardContent>
    </Card>
  )
}
