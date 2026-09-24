'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import {
  Search,
  Users,
  TrendingUp,
  Package,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { motion, AnimatePresence } from 'framer-motion'

interface SearchResult {
  id: string
  type: 'client' | 'opportunity' | 'product'
  title: string
  subtitle: string
}

export function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setView, setSelectedClientId } = useAppStore()

  const performSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Search clients, opportunities, services in parallel
      const [clientsRes, oppsRes, servicesRes] = await Promise.allSettled([
        api.getClients({ search: q.trim(), limit: '5' }),
        api.getOpportunities({ search: q.trim(), limit: '5' }),
        api.getServices(),
      ])

      const out: SearchResult[] = []

      if (clientsRes.status === 'fulfilled') {
        const clients = (clientsRes.value as { clients?: Array<{ id: string; name: string; phone: string; email?: string | null; company?: string | null }> }).clients ?? []
        clients.forEach((c) => {
          out.push({
            id: c.id,
            type: 'client',
            title: c.name,
            subtitle: c.company || c.phone,
          })
        })
      }

      if (oppsRes.status === 'fulfilled') {
        const opps = (oppsRes.value as { opportunities?: Array<{ id: string; title: string; estimatedValue: number; client?: { name: string } }> }).opportunities ?? []
        opps.forEach((o) => {
          out.push({
            id: o.id,
            type: 'opportunity',
            title: o.title,
            subtitle: o.client?.name ?? 'Sin cliente',
          })
        })
      }

      if (servicesRes.status === 'fulfilled') {
        const services = (servicesRes.value as { services?: Array<{ id: string; name: string; sku?: string | null; price: number }> }).services ?? []
        services
          .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || (s.sku ?? '').toLowerCase().includes(q.toLowerCase()))
          .slice(0, 5)
          .forEach((s) => {
            out.push({
              id: s.id,
              type: 'product',
              title: s.name,
              subtitle: s.sku ? `SKU: ${s.sku}` : 'Servicio',
            })
          })
      }

      setResults(out.slice(0, 12))
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      performSearch(query)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, performSearch])

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSelect = (result: SearchResult) => {
    setOpen(false)
    setQuery('')
    setResults([])
    if (result.type === 'client') {
      setSelectedClientId(result.id)
      setView('client-detail')
    } else if (result.type === 'opportunity') {
      setView('opportunities')
    } else if (result.type === 'product') {
      setView('products')
    }
  }

  const typeIcon = {
    client: <Users className="w-3.5 h-3.5" />,
    opportunity: <TrendingUp className="w-3.5 h-3.5" />,
    product: <Package className="w-3.5 h-3.5" />,
  }

  const typeColor = {
    client: 'bg-emerald-50 text-emerald-600',
    opportunity: 'bg-teal-50 text-teal-600',
    product: 'bg-amber-50 text-amber-600',
  }

  const typeLabel = {
    client: 'Cliente',
    opportunity: 'Oportunidad',
    product: 'Producto',
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.length >= 2 && setOpen(true)}
            placeholder="Buscar clientes, oportunidades, productos..."
            className="pl-8 pr-12 h-8 text-xs bg-slate-50 border-slate-200 focus:bg-white"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-mono bg-slate-100 border border-slate-200 rounded px-1 py-0.5 pointer-events-none">
            ⌘K
          </kbd>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[420px] p-0 shadow-xl border-slate-200"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {loading ? (
          <div className="p-6 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600 mx-auto" />
            <p className="text-xs text-slate-400 mt-2">Buscando...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center">
            <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              {query.trim().length < 2
                ? 'Escribe al menos 2 caracteres para buscar'
                : 'Sin resultados. Intenta con otro término.'}
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            <AnimatePresence>
              {results.map((result, i) => (
                <motion.button
                  key={`${result.type}-${result.id}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: i * 0.02 }}
                  onClick={() => handleSelect(result)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left group"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColor[result.type]}`}>
                    {typeIcon[result.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">{result.title}</p>
                    <p className="text-[10px] text-slate-400 truncate">{result.subtitle}</p>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-medium">
                    {typeLabel[result.type]}
                  </span>
                  <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
