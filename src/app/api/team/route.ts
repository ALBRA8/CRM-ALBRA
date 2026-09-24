import { NextRequest, NextResponse } from 'next/server'
import { checkPermission, requireAdmin, getRolePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { z } from 'zod'

// GET /api/team - List team members
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'users', 'read')
  if (perm instanceof NextResponse) return perm

  try {
    const members = await db.user.findMany({
      where: { id: { not: perm.userId } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        avatar: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            clients: true,
            opportunities: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Include permissions for each role
    const membersWithPerms = members.map(m => ({
      ...m,
      permissions: getRolePermissions(m.role),
    }))

    // Also include current user's role info
    const currentUser = await db.user.findUnique({
      where: { id: perm.userId },
      select: { role: true },
    })

    return NextResponse.json({
      members: membersWithPerms,
      currentRole: currentUser?.role,
      permissions: getRolePermissions(currentUser?.role || 'agent'),
    })
  } catch (error) {
    console.error('Team list error:', error)
    return NextResponse.json({ error: 'Error al obtener equipo' }, { status: 500 })
  }
}

// POST /api/team - Invite new team member
const inviteSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  email: z.string().email('Email invalido'),
  password: z.string().min(6, 'Contrasena minimo 6 caracteres'),
  role: z.enum(['admin', 'agent'], { errorMap: () => ({ message: 'Rol invalido. Solo admin o agent' }) }),
  phone: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const perm = await requireAdmin(request)
  if (perm instanceof NextResponse) return perm

  try {
    const body = await request.json()
    const validated = inviteSchema.parse(body)

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: validated.email } })
    if (existing) {
      return NextResponse.json({ error: 'Ya existe un usuario con este email' }, { status: 409 })
    }

    const hashedPassword = await hashPassword(validated.password)

    const newUser = await db.user.create({
      data: {
        name: validated.name,
        email: validated.email,
        password: hashedPassword,
        role: validated.role,
        phone: validated.phone || null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ user: newUser, message: 'Miembro agregado exitosamente' }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos invalidos', details: error.errors }, { status: 400 })
    }
    console.error('Team invite error:', error)
    return NextResponse.json({ error: 'Error al agregar miembro' }, { status: 500 })
  }
}
