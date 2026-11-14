'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ShieldCheck,
  Building2,
  Users,
  Package,
  RefreshCw,
  Server,
  Database,
  MessageCircle,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Boxes,
  Crown,
  UserCog,
  User,
  Activity,
  LogIn,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * Super Admin — plano de control multi-organización (solo rol superadmin).
 * La UI es solo presentación: el servidor re-valida el rol en cada llamada
 * (requireSuperAdmin en /api/super/overview). Los secretos jamás llegan aquí.
 */

interface SystemHealth {
  id: string
  name: string
  role: string
  url: string
  status: 'online' | 'offline' | 'degraded'
  latencyMs: number | null
  detail: Record<string, unknown>
}

interface OrgRow {
  id: string
  name: string
  slug: string
  plan: string
  isActive: boolean
  createdAt: string
  _count: {
    users: number
    clients: number
    opportunities: number
    quotes: number
    services: number
    reservations: number
    whatsappConversations: number
  }
}

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  leadCount: number
  lastLeadAt: string | null
  createdAt: string
  organization: { name: string; slug: string }
}

interface CatalogItem {
  id: string
  name: string
  category: string | null
  price: number
  unit: string
  isActive: boolean
}

interface Catalog {
  orgId: string
  orgName: string
  orgSlug: string
  total: number
  active: number
  items: CatalogItem[]
}

interface Overview {
  platform: { version: string; generatedAt: string; viewer: { name: string; role: string } }
  stats: {
    orgs: number
    orgsActive: number
    users: number
    usersByRole: Record<string, number>
    usersActive: number
    services: number
    servicesActive: number
    clients: number
    opportunities: number
    whatsappConversations: number
    systemsOnline: number
    systemsTotal: number
  }
  organizations: OrgRow[]
  users: UserRow[]
  catalogs: Catalog[]
  systems: SystemHealth[]
  integrations: {
    whatspowerBridge: { enabled: boolean; webhookSecretConfigured: boolean; url: string }
    daemon: { secretConfigured: boolean; url: string }
    ultra: { url: string }
  }
}

const roleConfig: Record<string, { label: string; className: string; icon: typeof Crown }> = {
  superadmin: { label: 'Super Admin', className: 'bg-emerald-600 text-white border-emerald-600', icon: ShieldCheck },
  owner: { label: 'Propietario', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: Crown },
  admin: { label: 'Administrador', className: 'bg-blue-100 text-blue-700 border-blue-200', icon: UserCog },
  agent: { label: 'Agente', className: 'bg-slate-100 text-slate-700 border-slate-200', icon: User },
  member: { label: 'Miembro', className: 'bg-slate-100 text-slate-500 border-slate-200', icon: User },
}

const systemIcon: Record<string, typeof Server> = {
  crm: Database,
  daemon: MessageCircle,
  whatspower: Radio,
  ultra: Radio,
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return value
  }
}

function RoleBadge({ role }: { role: string }) {
  const cfg = roleConfig[role] ?? roleConfig.member
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={`${cfg.className} gap-1`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  )
}

function HealthBadge({ status, latencyMs }: { status: SystemHealth['status']; latencyMs: number | null }) {
  if (status === 'online') {
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1" variant="outline">
        <CheckCircle2 className="w-3.5 h-3.5" /> En línea{latencyMs != null ? ` · ${latencyMs} ms` : ''}
      </Badge>
    )
  }
  if (status === 'degraded') {
    return (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1" variant="outline">
        <AlertTriangle className="w-3.5 h-3.5" /> Degradado
      </Badge>
    )
  }
  return (
    <Badge className="bg-red-50 text-red-700 border-red-200 gap-1" variant="outline">
      <XCircle className="w-3.5 h-3.5" /> Sin conexión
    </Badge>
  )
}

function KpiCard({ icon: Icon, label, value, hint }: { icon: typeof Building2; label: string; value: string; hint?: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[13px] text-slate-500 font-medium">{label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
            {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-emerald-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SuperPage() {
  const { user, setToken, setUser, setView } = useAppStore()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      const overview = (await api.getSuperOverview()) as Overview
      setData(overview)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar el panel de plataforma')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const enterOrganization = async (org: OrgRow) => {
    if (!org.isActive || switchingOrgId) return
    setSwitchingOrgId(org.id)
    try {
      const result = (await api.switchSuperOrganization(org.id)) as { token: string }
      if (!result?.token) throw new Error('El servidor no devolvió una sesión válida')
      // Mantener sincronizados el cliente API y el estado global de la sesión.
      api.setToken(result.token)
      setToken(result.token)
      const session = (await api.getMe()) as { user: Parameters<typeof setUser>[0] }
      setUser(session.user)
      setView('dashboard')
      toast.success(`Ahora estás trabajando en ${org.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo ingresar a la organización')
    } finally {
      setSwitchingOrgId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center text-slate-500">
            No se pudo cargar el panel. Intenta de nuevo con el botón de actualizar.
          </CardContent>
        </Card>
      </div>
    )
  }

  const { stats } = data

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Super Admin
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Plataforma multiusuario · v{data.platform.version} · vista de {user?.name ?? 'plataforma'} ({data.platform.viewer.role})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 hidden sm:inline">Actualizado: {formatDateTime(data.platform.generatedAt)}</span>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="resumen" className="space-y-4">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="resumen" className="gap-1.5">
            <Activity className="w-4 h-4" /> Resumen
          </TabsTrigger>
          <TabsTrigger value="organizaciones" className="gap-1.5">
            <Building2 className="w-4 h-4" /> Organizaciones ({stats.orgs})
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5">
            <Users className="w-4 h-4" /> Usuarios ({stats.users})
          </TabsTrigger>
          <TabsTrigger value="catalogos" className="gap-1.5">
            <Boxes className="w-4 h-4" /> Catálogos
          </TabsTrigger>
        </TabsList>

        {/* ---------- RESUMEN ---------- */}
        <TabsContent value="resumen" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={Building2}
              label="Organizaciones"
              value={String(stats.orgs)}
              hint={`${stats.orgsActive} activas`}
            />
            <KpiCard
              icon={Users}
              label="Usuarios"
              value={String(stats.users)}
              hint={`${stats.usersActive} activos · ${stats.usersByRole.owner ?? 0} propietario(s)`}
            />
            <KpiCard
              icon={Package}
              label="Servicios en catálogos"
              value={String(stats.services)}
              hint={`${stats.servicesActive} activos`}
            />
            <KpiCard
              icon={MessageCircle}
              label="Conversaciones WhatsApp"
              value={String(stats.whatsappConversations)}
              hint={`${stats.clients} clientes · ${stats.opportunities} oportunidades`}
            />
          </div>

          {/* Salud del ecosistema (3 niveles + daemon) */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-600" />
                Salud del ecosistema ({stats.systemsOnline}/{stats.systemsTotal} en línea)
              </CardTitle>
              <CardDescription>
                Los 3 mundos modulares y su canal: CRM (Nivel 1) → WHATSPOWER (Nivel 2) → ULTRA (Nivel 3), con el daemon de WhatsApp.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {data.systems.map((sys) => {
                const Icon = systemIcon[sys.id] ?? Server
                return (
                  <div key={sys.id} className="rounded-lg border border-slate-200 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-slate-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{sys.name}</p>
                          <p className="text-xs text-slate-400 truncate">{sys.role}</p>
                        </div>
                      </div>
                      <HealthBadge status={sys.status} latencyMs={sys.latencyMs} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 pl-10">
                      <span className="font-mono">{sys.url}</span>
                      {Object.entries(sys.detail).map(([k, v]) =>
                        v == null || v === '' ? null : (
                          <span key={k}>
                            {k}: <span className="text-slate-700 font-medium">{String(v)}</span>
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Puentes de integración (booleanos, nunca secretos) */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-600" />
                Puentes entre capas
              </CardTitle>
              <CardDescription>Configuración de los contratos que fusionan los 3 sistemas. Solo se muestra si hay secreto configurado, jamás su valor.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-800">CRM → WHATSPOWER</p>
                <p className="text-xs text-slate-400 font-mono mb-2">{data.integrations.whatspowerBridge.url}</p>
                <div className="flex flex-col gap-1.5 text-xs">
                  <span className="flex items-center gap-1.5">
                    {data.integrations.whatspowerBridge.enabled ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                    Puente habilitado (WHATSPOWER_ENABLED)
                  </span>
                  <span className="flex items-center gap-1.5">
                    {data.integrations.whatspowerBridge.webhookSecretConfigured ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                    Firma HMAC de inbound configurada
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-800">CRM → Daemon WhatsApp</p>
                <p className="text-xs text-slate-400 font-mono mb-2">{data.integrations.daemon.url}</p>
                <div className="flex flex-col gap-1.5 text-xs">
                  <span className="flex items-center gap-1.5">
                    {data.integrations.daemon.secretConfigured ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                    INTERNAL_API_SECRET configurado
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    El daemon exige Bearer en todos sus métodos (fail-closed)
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-800">ULTRA → WP → Daemon</p>
                <p className="text-xs text-slate-400 font-mono mb-2">{data.integrations.ultra.url}</p>
                <div className="flex flex-col gap-1.5 text-xs">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Doble gate de despacho real activo (simulación)
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    Envíos reales requieren cambio de código + piloto autorizado
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- ORGANIZACIONES ---------- */}
        <TabsContent value="organizaciones">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Organizaciones de la plataforma</CardTitle>
              <CardDescription>
                Cada organización es un tenant aislado: sus usuarios, clientes, catálogos y conversaciones nunca se cruzan con otra.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organización</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Usuarios</TableHead>
                    <TableHead className="text-center">Clientes</TableHead>
                    <TableHead className="text-center">Oport.</TableHead>
                    <TableHead className="text-center">Cotiz.</TableHead>
                    <TableHead className="text-center">Servicios</TableHead>
                    <TableHead className="text-center">Conv. WA</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acceso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.organizations.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{org.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{org.slug}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">{org.plan}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{org._count.users}</TableCell>
                      <TableCell className="text-center">{org._count.clients}</TableCell>
                      <TableCell className="text-center">{org._count.opportunities}</TableCell>
                      <TableCell className="text-center">{org._count.quotes}</TableCell>
                      <TableCell className="text-center">{org._count.services}</TableCell>
                      <TableCell className="text-center">{org._count.whatsappConversations}</TableCell>
                      <TableCell>
                        {org.isActive ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">Activa</Badge>
                        ) : (
                          <Badge className="bg-red-50 text-red-700 border-red-200" variant="outline">Inactiva</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={!org.isActive || switchingOrgId !== null}
                          onClick={() => enterOrganization(org)}
                        >
                          {switchingOrgId === org.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <LogIn className="w-3.5 h-3.5" />
                          )}
                          {switchingOrgId === org.id ? 'Ingresando…' : 'Ingresar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.organizations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-slate-400 py-8">
                        Aún no hay organizaciones registradas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- USUARIOS ---------- */}
        <TabsContent value="usuarios">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Usuarios clave de la plataforma</CardTitle>
              <CardDescription>
                Todos los usuarios de todas las organizaciones. Los roles de plataforma (Super Admin) y de organización (Propietario/Administrador) se muestran arriba.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Organización</TableHead>
                    <TableHead className="text-center">Leads asignados</TableHead>
                    <TableHead>Alta</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{u.name}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-700">{u.organization.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{u.organization.slug}</p>
                      </TableCell>
                      <TableCell className="text-center">{u.leadCount}</TableCell>
                      <TableCell className="text-sm text-slate-500">{formatDateTime(u.createdAt)}</TableCell>
                      <TableCell>
                        {u.isActive ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">Activo</Badge>
                        ) : (
                          <Badge className="bg-red-50 text-red-700 border-red-200" variant="outline">Inactivo</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                        Aún no hay usuarios registrados.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- CATÁLOGOS ---------- */}
        <TabsContent value="catalogos" className="space-y-4">
          {data.catalogs.map((cat) => (
            <Card key={cat.orgId} className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600" />
                  {cat.orgName}
                  <span className="text-xs font-normal text-slate-400 font-mono">{cat.orgSlug}</span>
                </CardTitle>
                <CardDescription>
                  {cat.total} servicio(s) · {cat.active} activos
                </CardDescription>
              </CardHeader>
              <CardContent>
                {cat.items.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">
                    Esta organización todavía no tiene productos/servicios en su catálogo.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Servicio</TableHead>
                        <TableHead>Categoría</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cat.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-slate-800">{item.name}</TableCell>
                          <TableCell className="text-slate-500">{item.category || '—'}</TableCell>
                          <TableCell className="text-right">
                            {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(item.price)}
                          </TableCell>
                          <TableCell className="text-slate-500">{item.unit}</TableCell>
                          <TableCell>
                            {item.isActive ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">Activo</Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-500 border-slate-200" variant="outline">Inactivo</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
          {data.catalogs.length === 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-10 text-center text-slate-500">
                No hay organizaciones ni catálogos todavía.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
