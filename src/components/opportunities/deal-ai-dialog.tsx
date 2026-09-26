'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, Copy, Check, ArrowUpRight, ArrowDownRight, Minus, Send } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Diálogo de IA de cierre (Fase 4): muestra la sugerencia generada para una
 * oportunidad (probabilidad, siguiente acción, mensaje y razonamiento) y
 * permite aplicarla (PUT /api/opportunities/:id), copiar el mensaje o enviarlo
 * directo por los canales con conversación activa (POST /api/inbox/send —
 * misma trazabilidad que la Bandeja: daemon WA / Bot API TG / Graph API IG).
 */

export interface DealAiSuggestion {
  probability: number
  nextBestAction: string
  suggestedMessage: string
  reasoning: string
}

/** Canal con conversación activa para el cliente de la oportunidad. */
export interface DealAiChannel {
  key: string
  channel: 'whatsapp' | 'telegram' | 'instagram'
  channelLabel: 'WhatsApp' | 'Telegram' | 'Instagram'
  contactHandle: string
}

export interface DealAiDialogData {
  oppId: string
  oppTitle: string
  clientId: string | null
  clientName: string
  currentProbability: number
  suggestion: DealAiSuggestion
  channels: DealAiChannel[]
}

interface DealAiDialogProps {
  open: boolean
  data: DealAiDialogData | null
  onClose: () => void
  /** Se invoca tras aplicar la sugerencia (para recargar el pipeline). */
  onApplied: () => void
}

export function DealAiDialog({ open, data, onClose, onApplied }: DealAiDialogProps) {
  const [applying, setApplying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sendingKey, setSendingKey] = useState<string | null>(null)

  if (!data) return null
  const { suggestion } = data
  const delta = suggestion.probability - data.currentProbability

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.suggestedMessage)
      setCopied(true)
      toast.success('Mensaje copiado al portapapeles')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar el mensaje')
    }
  }

  // Envío directo del mensaje sugerido por un canal con conversación activa.
  // Reutiliza POST /api/inbox/send (mismo camino que la Bandeja omnicanal).
  const handleSend = async (channel: DealAiChannel) => {
    if (sendingKey) return
    setSendingKey(channel.key)
    try {
      await api.sendInboxMessage({
        key: channel.key,
        contactHandle: channel.contactHandle,
        clientId: data.clientId,
        text: suggestion.suggestedMessage,
      })
      toast.success(`Mensaje enviado por ${channel.channelLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `No se pudo enviar por ${channel.channelLabel}`)
    } finally {
      setSendingKey(null)
    }
  }

  const handleApply = async () => {
    setApplying(true)
    try {
      await api.updateOpportunity(data.oppId, {
        probability: suggestion.probability,
        ...(suggestion.nextBestAction ? { nextAction: suggestion.nextBestAction } : {}),
      })
      toast.success('Sugerencia aplicada a la oportunidad')
      onClose()
      onApplied()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aplicar la sugerencia')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" /> Sugerencia IA de cierre
          </DialogTitle>
          <DialogDescription className="line-clamp-1">
            {data.oppTitle} · {data.clientName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Probabilidad sugerida vs actual */}
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-emerald-600">{suggestion.probability}%</span>
              <span className="text-xs text-slate-400">sugerido</span>
            </div>
            <Badge variant="secondary" className="gap-1 text-xs">
              {delta > 0 ? <ArrowUpRight className="w-3 h-3 text-emerald-600" /> : delta < 0 ? <ArrowDownRight className="w-3 h-3 text-red-500" /> : <Minus className="w-3 h-3 text-slate-400" />}
              actual {data.currentProbability}%
            </Badge>
          </div>

          {suggestion.nextBestAction && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Siguiente mejor acción</p>
              <p className="text-sm text-slate-900">{suggestion.nextBestAction}</p>
            </div>
          )}

          {suggestion.suggestedMessage && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mensaje sugerido</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                {suggestion.suggestedMessage}
              </div>
              {data.channels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {data.channels.map((c) => (
                    <Button
                      key={c.key}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => handleSend(c)}
                      disabled={!!sendingKey || applying}
                    >
                      {sendingKey === c.key ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                      Enviar por {c.channelLabel}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {suggestion.reasoning && (
            <p className="text-xs text-slate-400 leading-relaxed">{suggestion.reasoning}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {suggestion.suggestedMessage && (
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={applying}>
              {copied ? <Check className="w-4 h-4 mr-1.5 text-emerald-600" /> : <Copy className="w-4 h-4 mr-1.5" />}
              {copied ? 'Copiado' : 'Copiar mensaje'}
            </Button>
          )}
          <Button
            onClick={handleApply}
            disabled={applying}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {applying ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            Aplicar sugerencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
