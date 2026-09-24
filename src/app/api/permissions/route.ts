import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { getRolePermissions, isAtLeastRole } from '@/lib/permissions'
import { db } from '@/lib/db'

// GET /api/permissions - Get current user's permissions
export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth

  try {
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { role: true, isActive: true },
    })

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      role: user.role,
      permissions: getRolePermissions(user.role),
      isAdmin: isAtLeastRole(user.role, 'admin'),
      isOwner: user.role === 'owner',
    })
  } catch (error) {
    console.error('Permissions error:', error)
    return NextResponse.json({ error: 'Error al obtener permisos' }, { status: 500 })
  }
}
