import { NextResponse, type NextRequest } from 'next/server'

/**
 * Defensa en profundidad (auditoría externa): las páginas de la app ya se
 * protegen client-side y cada API valida JWT en el servidor; el middleware
 * añade el candado a nivel de borde — sin cookie de sesión ni Bearer no hay
 * HTML de la app que renderizar. No reemplaza la autorización del servidor.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('albra_session') || req.headers.has('authorization')
  if (!hasSession) {
    const url = new URL('/', req.url)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/clients/:path*',
    '/pipeline/:path*',
    '/inbox/:path*',
    '/calendar/:path*',
    '/quotes/:path*',
    '/products/:path*',
    '/finances/:path*',
    '/automations/:path*',
    '/reports/:path*',
    '/chat/:path*',
    '/team/:path*',
    '/settings/:path*',
    '/whatsapp/:path*',
    '/activity/:path*',
  ],
}
