'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Package,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  Clock,
  DollarSign,
  Tag,
  Filter,
  Grid3X3,
  List,
  ArrowUpDown,
  Eye,
  EyeOff,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

/* ──── Types ──── */

interface Service {
  id: string
  name: string
  description?: string | null
  category?: string | null
  price: number
  duration: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/* ──── Helpers ──── */

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value)

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  Consultoría: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  Diseño: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  Desarrollo: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  Marketing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  Soporte: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  Formación: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
}

function getCategoryStyle(cat: string | null) {
  if (!cat) return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' }
  return categoryColors[cat] ?? { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' }
}

/* ──── Main Component ──── */

export function ProductsPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [showForm, setShowForm] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Service | null>(null)

  const loadServices = useCallback(async () => {
    try {
      const data = await api.getServices()
      setServices((data.services as Service[]) ?? [])
    } catch {
      toast.error('Error al cargar productos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServices()
  }, [loadServices])

  // Categories from data
  const categories = [...new Set(services.map((s) => s.category).filter(Boolean))] as string[]

  // Filtered services
  const filtered = services.filter((s) => {
    const matchesSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description?.toLowerCase() ?? '').includes(search.toLowerCase()) ||
      (s.category?.toLowerCase() ?? '').includes(search.toLowerCase())
    const matchesCategory = !filterCategory || s.category === filterCategory
    return matchesSearch && matchesCategory
  })

  const handleSave = async (data: {
    name: string
    description: string
    category: string
    price: number
    duration: number
  }) => {
    try {
      if (editingService) {
        await api.updateService(editingService.id, data)
        toast.success('Producto actualizado')
      } else {
        await api.createService(data)
        toast.success('Producto creado')
      }
      setShowForm(false)
      setEditingService(null)
      loadServices()
    } catch {
      toast.error('Error al guardar producto')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteService(id)
      toast.success('Producto eliminado')
      setDeleteConfirm(null)
      loadServices()
    } catch {
      toast.error('Error al eliminar producto')
    }
  }

  const handleToggleActive = async (service: Service) => {
    try {
      await api.updateService(service.id, { isActive: !service.isActive })
      toast.success(service.isActive ? 'Producto desactivado' : 'Producto activado')
      loadServices()
    } catch {
      toast.error('Error al actualizar producto')
    }
  }

  // Stats
  const activeCount = services.filter((s) => s.isActive).length
  const avgPrice = services.length > 0 ? services.reduce((a, s) => a + s.price, 0) / services.length : 0
  const totalValue = services.filter((s) => s.isActive).reduce((a, s) => a + s.price, 0)

  /* ---- Loading State ---- */
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Productos y Servicios</h1>
          <p className="text-sm text-slate-500 mt-1">Gestiona tu catálogo de productos y servicios</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <Skeleton className="w-24 h-6 rounded mt-3" />
                <Skeleton className="w-16 h-3 rounded mt-1" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  /* ---- Render ---- */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Productos y Servicios</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestiona tu catálogo de productos y servicios</p>
        </div>
        <Button
          onClick={() => { setEditingService(null); setShowForm(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-sm gap-2"
        >
          <Plus className="w-4 h-4" /> Nuevo Producto
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Package className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 tracking-tight">{activeCount}</p>
                  <p className="text-xs text-slate-500">Productos Activos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 tracking-tight">{formatCurrency(avgPrice)}</p>
                  <p className="text-xs text-slate-500">Precio Promedio</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Tag className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 tracking-tight">{categories.length}</p>
                  <p className="text-xs text-slate-500">Categorías</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar productos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm bg-white border-slate-200"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Category Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5" />
                {filterCategory ?? 'Categoría'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setFilterCategory(null)}>
                Todas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {categories.map((cat) => (
                <DropdownMenuItem key={cat} onClick={() => setFilterCategory(cat)}>
                  {cat}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Toggle */}
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              className={`h-9 w-9 p-0 rounded-none ${viewMode === 'grid' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className={`h-9 w-9 p-0 rounded-none ${viewMode === 'list' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <List className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Package className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700">
              {services.length === 0 ? 'Sin productos aún' : 'Sin resultados'}
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
              {services.length === 0
                ? 'Agrega tu primer producto o servicio para comenzar a gestionar tu catálogo.'
                : 'No se encontraron productos con los filtros actuales.'}
            </p>
            {services.length === 0 && (
              <Button
                onClick={() => { setEditingService(null); setShowForm(true) }}
                className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                <Plus className="w-4 h-4" /> Crear Primer Producto
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((service, idx) => {
              const catStyle = getCategoryStyle(service.category ?? null)
              return (
                <motion.div
                  key={service.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                  layout
                >
                  <Card className={`border-0 shadow-sm bg-white hover:shadow-md transition-all duration-200 group relative ${!service.isActive ? 'opacity-60' : ''}`}>
                    <CardContent className="p-5">
                      {/* Top Row: Category + Menu */}
                      <div className="flex items-center justify-between mb-3">
                        {service.category ? (
                          <Badge className={`text-[10px] h-5 px-2 border ${catStyle.bg} ${catStyle.text} ${catStyle.border} font-medium`}>
                            {service.category}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-slate-300">Sin categoría</span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => { setEditingService(service); setShowForm(true) }}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleActive(service)}>
                              {service.isActive ? (
                                <><EyeOff className="w-3.5 h-3.5 mr-2" /> Desactivar</>
                              ) : (
                                <><Eye className="w-3.5 h-3.5 mr-2" /> Activar</>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteConfirm(service)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Product Name */}
                      <h3 className="text-sm font-bold text-slate-900 line-clamp-1">{service.name}</h3>

                      {/* Description */}
                      {service.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{service.description}</p>
                      )}

                      {/* Price & Duration */}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-sm font-bold text-emerald-700">{formatCurrency(service.price)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="w-3 h-3" />
                          {service.duration} min
                        </div>
                      </div>

                      {/* Inactive badge */}
                      {!service.isActive && (
                        <div className="absolute top-2 left-2">
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5 bg-slate-100 text-slate-500">
                            Inactivo
                          </Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      ) : (
        /* List View */
        <Card className="border-0 shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600">
                      Producto <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Categoría</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Precio</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Duración</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Estado</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {filtered.map((service) => {
                    const catStyle = getCategoryStyle(service.category ?? null)
                    return (
                      <motion.tr
                        key={service.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${!service.isActive ? 'opacity-60' : ''}`}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                              <Package className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 truncate">{service.name}</p>
                              {service.description && (
                                <p className="text-xs text-slate-400 truncate max-w-[250px]">{service.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {service.category ? (
                            <Badge className={`text-[10px] h-5 px-2 border ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}>
                              {service.category}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-emerald-700">{formatCurrency(service.price)}</td>
                        <td className="px-5 py-3.5 text-center text-xs text-slate-500">{service.duration} min</td>
                        <td className="px-5 py-3.5 text-center">
                          <Badge className={`text-[10px] h-5 px-2 border-0 ${service.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {service.isActive ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-emerald-600"
                              onClick={() => { setEditingService(service); setShowForm(true) }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-red-500"
                              onClick={() => setDeleteConfirm(service)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Product Form Dialog */}
      <ProductFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingService(null) }}
        onSave={handleSave}
        service={editingService}
        categories={categories}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Eliminar Producto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            ¿Estás seguro de eliminar <span className="font-semibold">"{deleteConfirm?.name}"</span>? Esta acción no se puede deshacer.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm.id)}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ──── Product Form Dialog ──── */

function ProductFormDialog({
  open,
  onClose,
  onSave,
  service,
  categories,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: { name: string; description: string; category: string; price: number; duration: number }) => void
  service: Service | null
  categories: string[]
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [price, setPrice] = useState('')
  const [duration, setDuration] = useState('60')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (service) {
      setName(service.name)
      setDescription(service.description ?? '')
      setCategory(service.category ?? '')
      setCustomCategory('')
      setPrice(service.price.toString())
      setDuration(service.duration.toString())
    } else {
      setName('')
      setDescription('')
      setCategory('')
      setCustomCategory('')
      setPrice('')
      setDuration('60')
    }
  }, [service, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category: category === '__custom__' ? customCategory.trim() : category,
        price: parseFloat(price) || 0,
        duration: parseInt(duration) || 60,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {service ? 'Editar Producto' : 'Nuevo Producto'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700">Nombre *</label>
            <Input
              placeholder="Nombre del producto o servicio"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700">Descripción</label>
            <Input
              placeholder="Descripción breve"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700">Categoría</label>
            <div className="flex gap-2">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex-1 h-9 text-sm border border-slate-200 rounded-md px-3 bg-white"
              >
                <option value="">Sin categoría</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="__custom__">+ Nueva categoría</option>
              </select>
            </div>
            {category === '__custom__' && (
              <Input
                placeholder="Nombre de la nueva categoría"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="h-9 text-sm mt-2"
              />
            )}
          </div>

          {/* Price & Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700">Precio (COP)</label>
              <Input
                type="number"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700">Duración (min)</label>
              <Input
                type="number"
                placeholder="60"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Guardando...' : service ? 'Guardar Cambios' : 'Crear Producto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
