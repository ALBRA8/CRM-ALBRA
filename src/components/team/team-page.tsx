'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Shield,
  UserPlus,
  Loader2,
  Users,
  Crown,
  UserCog,
  User,
  Trash2,
  CheckCircle,
  XCircle,
  Mail,
  Phone,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

interface TeamMember {
  id: string
  name: string
  email: string
  role: string
  phone?: string
  isActive: boolean
  createdAt: string
  _count?: { clients: number; opportunities: number }
}

const roleConfig: Record<string, { label: string; icon: typeof Crown; color: string; description: string }> = {
  owner: { label: 'Propietario', icon: Crown, color: 'bg-amber-100 text-amber-700', description: 'Acceso total al sistema' },
  admin: { label: 'Administrador', icon: UserCog, color: 'bg-blue-100 text-blue-700', description: 'Puede gestionar equipo y configuración' },
  agent: { label: 'Agente', icon: User, color: 'bg-slate-100 text-slate-700', description: 'Acceso a clientes y oportunidades' },
}

export function TeamPage() {
  const { isAdmin } = useAppStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', password: '', role: 'agent' as string, phone: '' })

  useEffect(() => {
    loadTeam()
  }, [])

  const loadTeam = async () => {
    try {
      setLoading(true)
      const data = await api.getTeam() as { members: TeamMember[] }
      setMembers(data.members || [])
    } catch {
      toast.error('Error al cargar equipo')
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteForm.name || !inviteForm.email || !inviteForm.password) {
      toast.error('Completa todos los campos obligatorios')
      return
    }
    if (inviteForm.password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setInviteLoading(true)
    try {
      await api.inviteTeamMember(inviteForm)
      toast.success('Miembro agregado exitosamente')
      setShowInvite(false)
      setInviteForm({ name: '', email: '', password: '', role: 'agent', phone: '' })
      loadTeam()
    } catch (err: any) {
      toast.error(err.message || 'Error al agregar miembro')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleDeactivate = async (id: string) => {
    if (!confirm('Desactivar este miembro? Podrá ser reactivado después.')) return
    try {
      await api.deactivateTeamMember(id)
      toast.success('Miembro desactivado')
      loadTeam()
    } catch {
      toast.error('Error al desactivar miembro')
    }
  }

  const handleUpdateRole = async (id: string, newRole: string) => {
    try {
      await api.updateTeamMember(id, { role: newRole })
      toast.success('Rol actualizado')
      loadTeam()
    } catch {
      toast.error('Error al actualizar rol')
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipo</h1>
          <p className="text-sm text-slate-500 mt-1">Gestiona los miembros de tu equipo</p>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center">
            <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-1">Acceso Restringido</h3>
            <p className="text-sm text-slate-500">Solo los administradores pueden gestionar el equipo.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Equipo</h1>
            <p className="text-sm text-slate-500 mt-1">Gestiona los miembros de tu equipo</p>
          </div>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
            <p className="text-sm text-slate-500 mt-3">Cargando equipo...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const activeMembers = members.filter(m => m.isActive)
  const inactiveMembers = members.filter(m => !m.isActive)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipo</h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeMembers.length} miembros activos · {inactiveMembers.length} inactivos
          </p>
        </div>
        <Button
          onClick={() => setShowInvite(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <UserPlus className="w-4 h-4 mr-2" /> Agregar Miembro
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.entries(roleConfig).map(([role, config]) => {
          const count = activeMembers.filter(m => m.role === role).length
          const Icon = config.icon
          return (
            <motion.div
              key={role}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{count}</p>
                    <p className="text-xs text-slate-500">{config.label}s</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Members Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Miembros del Equipo</CardTitle>
            <CardDescription>Administra roles y permisos de cada miembro</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Miembro</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Clientes</TableHead>
                  <TableHead>Oportunidades</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMembers.map((member) => {
                  const roleInfo = roleConfig[member.role] ?? roleConfig.agent
                  const RoleIcon = roleInfo.icon
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{member.name}</p>
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <Mail className="w-3 h-3" /> {member.email}
                            </div>
                            {member.phone && (
                              <div className="flex items-center gap-1 text-xs text-slate-400">
                                <Phone className="w-3 h-3" /> {member.phone}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(v) => handleUpdateRole(member.id, v)}
                          disabled={member.role === 'owner'}
                        >
                          <SelectTrigger className="w-36 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner" disabled>Propietario</SelectItem>
                            <SelectItem value="admin">Administrador</SelectItem>
                            <SelectItem value="agent">Agente</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-slate-600">{member._count?.clients ?? 0}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-slate-600">{member._count?.opportunities ?? 0}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-50 text-emerald-700 border-0">
                          <CheckCircle className="w-3 h-3 mr-1" /> Activo
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {member.role !== 'owner' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8"
                            onClick={() => handleDeactivate(member.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {inactiveMembers.map((member) => (
                  <TableRow key={member.id} className="opacity-50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm font-bold">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-500">{member.name}</p>
                          <p className="text-xs text-slate-400">{member.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-400">{roleConfig[member.role]?.label ?? member.role}</span>
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <Badge className="bg-slate-100 text-slate-500 border-0">
                        <XCircle className="w-3 h-3 mr-1" /> Inactivo
                      </Badge>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Miembro al Equipo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={inviteForm.name}
                onChange={(e) => setInviteForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nombre completo"
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm(f => ({ ...f, email: e.target.value }))}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Contraseña *</Label>
              <Input
                type="password"
                value={inviteForm.password}
                onChange={(e) => setInviteForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                value={inviteForm.phone}
                onChange={(e) => setInviteForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+52 55 1234 5678"
              />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={inviteForm.role} onValueChange={(v) => setInviteForm(f => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="agent">Agente</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {roleConfig[inviteForm.role]?.description}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancelar</Button>
            <Button
              onClick={handleInvite}
              disabled={inviteLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {inviteLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
