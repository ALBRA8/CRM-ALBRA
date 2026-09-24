'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ClientFormDialog } from './client-form-dialog'
import {
  Search,
  Plus,
  Users,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Trash2,
  Globe,
  MessageCircle,
  UserPlus,
  HandMetal,
  RefreshCw,
  Flame,
  Sun,
  Snowflake,
  Thermometer,
  UserRound,
  Download,
  Upload,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'

interface Client {
  id: string
  name: string
  email?: string | null
  phone: string
  company?: string | null
  source: string
  temperature: string
  score: number
  lastContactAt?: string | null
  createdAt: string
  _count?: { opportunities: number; reservations: number }
}

interface PaginationData {
  page: number
  limit: number
  total: number
  totalPages: number
}

const temperatureConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  Frio: { label: 'Frío', color: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200', icon: <Snowflake className="w-3 h-3" /> },
  Tibio: { label: 'Tibio', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100', icon: <Sun className="w-3 h-3" /> },
  Caliente: { label: 'Caliente', color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100', icon: <Thermometer className="w-3 h-3" /> },
  Fuego: { label: 'Fuego', color: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100', icon: <Flame className="w-3 h-3" /> },
}

const sourceConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  manual: { label: 'Manual', icon: <HandMetal className="w-3 h-3" /> },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle className="w-3 h-3" /> },
  web: { label: 'Web', icon: <Globe className="w-3 h-3" /> },
  referral: { label: 'Referido', icon: <UserPlus className="w-3 h-3" /> },
  telegram: { label: 'Telegram', icon: <MessageCircle className="w-3 h-3" /> },
}

const sourceFilters = [
  { value: 'all', label: 'Todos' },
  { value: 'web', label: 'Web' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'Referido' },
  { value: 'manual', label: 'Manual' },
]

const tempFilters = [
  { value: 'all', label: 'Todos' },
  { value: 'Frio', label: 'Frío' },
  { value: 'Tibio', label: 'Tibio' },
  { value: 'Caliente', label: 'Caliente' },
  { value: 'Fuego', label: 'Fuego' },
]

export function ClientsList() {
  const { setView, setSelectedClientId } = useAppStore()
  const [clients, setClients] = useState<Client[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [temperatureFilter, setTemperatureFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [page, setPage] = useState(1)

  // Dialog states
  const [showForm, setShowForm] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search])

  const loadClients = useCallback(async () => {
    try {
      setError(false)
      setLoading(true)
      const params: Record<string, string> = { page: page.toString(), limit: '20' }
      if (debouncedSearch) params.search = debouncedSearch
      if (temperatureFilter !== 'all') params.temperature = temperatureFilter
      if (sourceFilter !== 'all') params.source = sourceFilter

      const data = await api.getClients(params)
      setClients(data.clients as Client[])
      setPagination(data.pagination as PaginationData)
    } catch {
      setError(true)
      toast.error('Error al cargar clientes')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, temperatureFilter, sourceFilter])

  useEffect(() => {
    loadClients()
  }, [loadClients])

  const handleRowClick = (clientId: string) => {
    setSelectedClientId(clientId)
    setView('client-detail')
  }

  const handleView = (e: React.MouseEvent, clientId: string) => {
    e.stopPropagation()
    setSelectedClientId(clientId)
    setView('client-detail')
  }

  const handleEdit = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation()
    setEditClient(client)
    setShowForm(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteClient(deleteTarget.id)
      toast.success('Cliente eliminado exitosamente')
      setDeleteTarget(null)
      loadClients()
    } catch {
      toast.error('Error al eliminar cliente')
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditClient(null)
    loadClients()
  }

  const scoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500'
    if (score >= 60) return 'bg-teal-500'
    if (score >= 40) return 'bg-amber-500'
    if (score >= 20) return 'bg-orange-500'
    return 'bg-red-500'
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">Clientes</h1>
          {!loading && (
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-0.5">
              {pagination.total}
            </Badge>
          )}
        </div>
        <Button
          onClick={() => { setEditClient(null); setShowForm(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm h-8 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo Cliente
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.open(api.getExportCsvUrl('clients'), '_blank')
          }}
          className="h-8 text-xs gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Exportar CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowImport(true)}
          className="h-8 text-xs gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" /> Importar CSV
        </Button>
      </div>

      {/* Search & Filters */}
      <Card className="border-0 shadow-sm p-3">
        <div className="space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Buscar por nombre, email o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>

          {/* Source Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500 self-center mr-0.5">Fuente:</span>
            {sourceFilters.map((f) => (
              <Button
                key={f.value}
                variant={sourceFilter === f.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSourceFilter(f.value); setPage(1) }}
                className={
                  sourceFilter === f.value
                    ? 'h-6 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'h-6 text-[11px]'
                }
              >
                {f.label}
              </Button>
            ))}
          </div>

          {/* Temperature Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500 self-center mr-0.5">Temp:</span>
            {tempFilters.map((f) => (
              <Button
                key={f.value}
                variant={temperatureFilter === f.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setTemperatureFilter(f.value); setPage(1) }}
                className={
                  temperatureFilter === f.value
                    ? 'h-6 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'h-6 text-[11px]'
                }
              >
                {f.value !== 'all' && temperatureConfig[f.value]?.icon}
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-0 shadow-sm p-6 text-center">
          <p className="text-sm text-red-600 mb-3">No se pudieron cargar los clientes</p>
          <Button variant="outline" size="sm" onClick={loadClients}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        </Card>
      )}

      {/* Table */}
      {!error && (
        <Card className="border-0 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : clients.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <UserRound className="w-10 h-10 text-emerald-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700">
                {debouncedSearch || sourceFilter !== 'all' || temperatureFilter !== 'all'
                  ? 'Sin resultados'
                  : 'Agrega tu primer cliente'}
              </h3>
              <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                {debouncedSearch || sourceFilter !== 'all' || temperatureFilter !== 'all'
                  ? 'Intenta ajustar los filtros de búsqueda para encontrar lo que buscas'
                  : 'Comienza registrando tus contactos y prospectos para gestionarlos fácilmente'}
              </p>
              {!debouncedSearch && sourceFilter === 'all' && temperatureFilter === 'all' && (
                <Button
                  onClick={() => { setEditClient(null); setShowForm(true) }}
                  className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Agregar Cliente
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Nombre</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Email</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Teléfono</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Empresa</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Fuente</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Temp.</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Score</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider hidden xl:table-cell">Último Contacto</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence mode="popLayout">
                    {clients.map((client, index) => {
                      const tempConf = temperatureConfig[client.temperature]
                      const srcConf = sourceConfig[client.source]
                      return (
                        <motion.tr
                          key={client.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2, delay: index * 0.02 }}
                          className="border-b border-slate-50 hover:bg-emerald-50/30 cursor-pointer transition-colors group"
                          onClick={() => handleRowClick(client.id)}
                        >
                          <TableCell className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 group-hover:bg-emerald-200 transition-colors">
                                {client.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-slate-900 truncate">{client.name}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-[13px] text-slate-600 hidden md:table-cell truncate max-w-[180px]">
                            {client.email ?? <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="text-[13px] text-slate-600 hidden sm:table-cell">
                            {client.phone}
                          </TableCell>
                          <TableCell className="text-[13px] text-slate-600 hidden lg:table-cell truncate max-w-[140px]">
                            {client.company ?? <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {srcConf ? (
                              <Badge variant="outline" className="text-[11px] font-normal gap-1">
                                {srcConf.icon}
                                {srcConf.label}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[11px] font-normal">{client.source}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {tempConf ? (
                              <Badge variant="outline" className={`text-[11px] border gap-1 ${tempConf.color}`}>
                                {tempConf.icon}
                                {tempConf.label}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[11px]">{client.temperature}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="w-14">
                                <Progress value={client.score} className={`h-1.5 ${scoreColor(client.score)}`} />
                              </div>
                              <span className="text-[11px] text-slate-500 w-6 text-right">{client.score}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-[11px] text-slate-400 hidden xl:table-cell">
                            {client.lastContactAt
                              ? formatDistanceToNow(new Date(client.lastContactAt), { addSuffix: true, locale: es })
                              : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <TooltipProvider delayDuration={200}>
                              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                                      onClick={(e) => handleView(e, client.id)}
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Ver detalle</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                                      onClick={(e) => handleEdit(e, client)}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Editar</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(client) }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Eliminar</TooltipContent>
                                </Tooltip>
                              </div>
                            </TooltipProvider>
                          </TableCell>
                        </motion.tr>
                      )
                    })}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {!loading && clients.length > 0 && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">
                Mostrando {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} de {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="h-8 gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                    let pageNum: number
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1
                    } else if (page <= 3) {
                      pageNum = i + 1
                    } else if (page >= pagination.totalPages - 2) {
                      pageNum = pagination.totalPages - 4 + i
                    } else {
                      pageNum = page - 2 + i
                    }
                    return (
                      <Button
                        key={pageNum}
                        variant={page === pageNum ? 'default' : 'outline'}
                        size="icon"
                        className={`h-8 w-8 ${page === pageNum ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                        onClick={() => setPage(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    )
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
                  disabled={page === pagination.totalPages}
                  className="h-8 gap-1"
                >
                  Siguiente <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Client Form Dialog */}
      <ClientFormDialog
        open={showForm}
        onClose={handleFormClose}
        editClient={editClient}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el cliente
              <span className="font-semibold text-slate-700"> {deleteTarget?.name}</span> y
              todos sus datos asociados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import CSV Dialog */}
      <AlertDialog open={showImport} onOpenChange={setShowImport}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Importar Clientes desde CSV</AlertDialogTitle>
            <AlertDialogDescription>
              Sube un archivo CSV con columnas: nombre, telefono, email, empresa, ciudad, fuente, notas.
              La primera fila debe ser el encabezado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <input
              type="file"
              accept=".csv"
              id="csv-import-input"
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setImporting(true)
                try {
                  const result = await api.importCsv(file, 'clients') as { created: number; skipped: number; errors: number }
                  toast.success(`Importación completada`, {
                    description: `Creados: ${result.created}, Omitidos: ${result.skipped}, Errores: ${result.errors}`
                  })
                  setShowImport(false)
                  loadClients()
                } catch {
                  toast.error('Error al importar CSV')
                } finally {
                  setImporting(false)
                }
              }}
            />
            {importing && <p className="text-sm text-slate-500 mt-2">Importando...</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
