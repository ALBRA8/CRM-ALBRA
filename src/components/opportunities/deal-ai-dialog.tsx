'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Sparkles, Copy, Check, ArrowUpRight, ArrowDownRight, Minus, Send, Info, PenLine } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Diálogo de IA de cierre (Fase 4): muestra la sugerencia generada para una
 * oportunidad (probabilidad, siguiente acción, mensaje y razonamiento) y
 * permite aplicarla (PUT /api/opportunities/:id), copiar el mensaje, EDITARLO
 * (auto-mejora Fase 5: la edición se guarda como lección de estilo para el
 * agente vía POST /api/agent/corrections) o enviarlo directo por los canales
 * con conversación activa (POST /api/inbox/send — misma trazabilidad que la
 * Bandeja: daemon WA / Bot API TG / Graph API IG).
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

/**
 * Bloque editable del mensaje sugerido (Fase 5 auto-mejora).
 * Componente interno con estado propio: se remonta por `key` cuando cambia la
 * sugerencia, así el textarea siempre arranca con el texto nuevo sin efectos.
 * Si el vendedor edita el mensaje antes de enviarlo, el par original→final se
 * guarda como lección de estilo (fire-and-forget; nunca bloquea el envío).
 */
function MessageSendBlock({
  initial,
  clientId,
  channels,
  disabled,
  onAfterSend,
}: {
  initial: string
  clientId: string | null
  channels: DealAiChannel[]
  disabled: boolean
  onAfterSend: () => void
}) {
  const [message, setMessage] = useState(initial)
  const [copied, setCopied] = useState(false)
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const edited = message.trim() !== initial.trim()

  const learnCorrection = () => {
    if (!edited) return
    // Fire-and-forget: la lección de estilo no puede retrasar ni tumbar el envío.
    void fetch('/api/agent/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original: initial, final: message.trim(), clientId }),
    }).catch(() => {})
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      toast.success('Mensaje copiado al portapapeles')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar el mensaje')
    }
  }

  const handleSend = async (channel: DealAiChannel) => {
    if (sendingKey || !message.trim()) return
    setSendingKey(channel.key)
    try {
      await api.sendInboxMessage({
        key: channel.key,
        contactHandle: channel.contactHandle,
        clientId,
        text: message.trim(),
      })
      learnCorrection()
      toast.success(edited ? `Mensaje ajustado y enviado por ${channel.channelLabel} (el agente aprendió tu estilo)` : `Mensaje enviado por ${channel.channelLabel}`)
      onAfterSend()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `No se pudo enviar por ${channel.channelLabel}`)
    } finally {
      setSendingKey(null)
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
        Mensaje sugerido
        {edited && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 normal-case tracking-normal">
            <PenLine className="w-3 h-3" /> editado — el agente aprende tu estilo
          </span>
        )}
      </p>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="text-sm bg-slate-50 resize-none"
        aria-label="Mensaje sugerido por la IA, editable"
      />
      {channels.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {channels.map((c) => (
            <Button
              key={c.key}
              variant="outline"
              size="sm"
              className="h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              onClick={() => handleSend(c)}
              disabled={!!sendingKey || disabled || !message.trim()}
            >
              {sendingKey === c.key ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
              Enviar por {c.channelLabel}
            </Button>
          ))}
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Este cliente no tiene canales activos conectados. Copia el mensaje y envíalo manualmente.
        </p>
      )}
    </div>
  )
}

export function DealAiDialog({ open, data, onClose, onApplied }: DealAiDialogProps) {
  const [applying, setApplying] = useState(false)

  if (!data) return null
  const { suggestion } = data
  const delta = suggestion.probability - data.currentProbability

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
            <MessageSendBlock
              key={`${data.oppId}-${suggestion.suggestedMessage.slice(0, 40)}`}
              initial={suggestion.suggestedMessage}
              clientId={data.clientId}
              channels={data.channels}
              disabled={applying}
              onAfterSend={() => {}}
            />
          )}

          {suggestion.reasoning && (
            <p className="text-xs text-slate-400 leading-relaxed">{suggestion.reasoning}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
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
