// SEED DE HUMO: crea Organization+User admin en la BD del CRM y firma un JWT
// de sesión con el APP_SECRET NUEVO del .env (mecanismo real de auth.ts).
// El token sale SOLO por stdout (capturado a env por el orquestador; nunca en logs/evidencia).
process.chdir('/home/z/repos-limpio/CRM-ALBRA')
const fs = await import('node:fs')
const envText = fs.readFileSync('/home/z/repos-limpio/CRM-ALBRA/.env', 'utf8')
for (const m of envText.matchAll(/^([A-Z_]+)=(.*)$/gm)) process.env[m[1]] ??= m[2]

const { PrismaClient } = await import('@prisma/client')
const { createHmac, randomBytes, scryptSync } = await import('node:crypto')

// Réplica EXACTA de auth.ts (no importable fuera de Next por 'next/server'):
// hashPassword (scrypt:64) y signToken (JWT HS256 firmado con APP_SECRET).
const APP_SECRET = process.env.APP_SECRET
if (!APP_SECRET || APP_SECRET.length < 24) { console.error('APP_SECRET ausente'); process.exit(2) }
const b64url = (x) => Buffer.from(x).toString('base64url')
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}
function signToken(payload, days = 7) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = { ...payload, exp: Date.now() + days * 86400_000 }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', APP_SECRET).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

const db = new PrismaClient()
const org = await db.organization.upsert({
  where: { slug: 'smoke-r2' },
  update: {},
  create: { name: 'SMOKE R2 (ventana controlada)', slug: 'smoke-r2' },
})
const email = 'smoke-r2@albra.local'
const user = await db.user.upsert({
  where: { email },
  update: { role: 'admin', isActive: true, organizationId: org.id },
  create: {
    email, name: 'SMOKE R2 Admin', role: 'admin', organizationId: org.id,
    passwordHash: hashPassword(randomBytes(24).toString('hex')),
  },
})
const token = signToken({ userId: user.id, orgId: org.id, role: 'admin', email })
await db.$disconnect()
process.stdout.write(token)
