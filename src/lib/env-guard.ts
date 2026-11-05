/**
 * P0.4 — Guardia de secretos de entorno (fail-fast).
 *
 * Garantía: un despliegue de PRODUCCIÓN no puede arrancar con secretos de
 * ejemplo, marcadores sin reemplazar, vacíos, cortos (<32) o de baja entropía.
 * En desarrollo NUNCA bloquea (solo advierte) para no romper el flujo local;
 * `scripts/ensure-env.mjs` (predev) ya genera secretos fuertes automáticos.
 *
 * Se invoca desde src/instrumentation.ts en el arranque del servidor Next.js
 * y el daemon (src/whatsapp-daemon/daemon.mjs) aplica su propio check para
 * INTERNAL_API_SECRET.
 *
 * Valores de ejemplo/dummy reconocidos (incluidos los del CI, que son
 * test-only): si aparecen en un entorno productivo, el arranque muere.
 */

export type EnvMode = 'production' | 'development'

export interface EnvIssue {
  key: string
  problem: string
}

export interface EnvReport {
  mode: EnvMode
  ok: boolean
  errors: EnvIssue[]
  warnings: EnvIssue[]
}

/** Valores que JAMÁS son válidos como secretos (ejemplos, marcadores, dummies). */
export const KNOWN_INSECURE_VALUES: ReadonlySet<string> = new Set([
  // ejemplos históricos del .env.example (rotados en P0.4)
  'cambia-esto-por-un-secreto-largo-y-aleatorio',
  'cambia-esto-por-otra-clave-larga-y-aleatoria',
  'cambia-esto-secreto-interno-daemon',
  'token-de-verificacion-webhook',
  'contraseña-smtp',
  // marcadores de la plantilla P0.4
  'replace_with_strong_random_secret',
  'replace_with_smtp_user',
  'replace_with_smtp_password',
  // clásicos débiles
  'changeme',
  'change-me',
  'changeit',
  'password',
  'secret',
  'test',
  'dummy',
  // token dev conocido del puente Agente General (documentado como prohibido)
  'albra-dev-token',
  // dummies del CI (jamás deben llegar a un entorno real)
  'ci-dummy-secret-test-only-0123456789abcdef',
  'ci-dummy-key-test-only-0123456789abcdef',
  'ci-dummy-internal-test-only-0123456789abcdef',
])

const MIN_SECRET_LENGTH = 32

/**
 * Devuelve la razón por la que un valor es débil, o null si es aceptable.
 * Heurísticas: marcador sin reemplazar, valor conocido, longitud mínima,
 * frase humana sin dígitos, baja entropía (pocos caracteres distintos).
 */
export function weakSecretReason(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return 'ausente'
  const v = value.trim().replace(/^["']|["']$/g, '')
  if (!v) return 'vacío'
  if (/^replace_with/i.test(v)) return 'marcador REPLACE_WITH_* sin reemplazar'
  if (KNOWN_INSECURE_VALUES.has(v.toLowerCase())) return 'valor de ejemplo/conocido'
  if (v.length < MIN_SECRET_LENGTH) return `demasiado corto (${v.length} < ${MIN_SECRET_LENGTH})`
  if (/^[a-z]+([-_ ][a-z]+)*$/i.test(v)) return 'frase predecible sin entropía'
  const distinct = new Set(v).size
  if (distinct < 12) return `baja entropía (${distinct} caracteres distintos)`
  return null
}

function get(key: string): string | undefined {
  const v = process.env[key]
  return v === undefined ? undefined : v.trim().replace(/^["']|["']$/g, '')
}

export function validateEnv(mode: EnvMode): EnvReport {
  const errors: EnvIssue[] = []
  const warnings: EnvIssue[] = []
  const push = (list: EnvIssue[], key: string, problem: string) => list.push({ key, problem })

  // ---------- Obligatorios siempre ----------
  const databaseUrl = get('DATABASE_URL')
  if (!databaseUrl) push(mode === 'production' ? errors : warnings, 'DATABASE_URL', 'ausente')

  // ---------- Secretos core: error en producción, advertencia en desarrollo ----------
  for (const key of ['APP_SECRET', 'APP_ENCRYPTION_KEY', 'INTERNAL_API_SECRET']) {
    const reason = weakSecretReason(get(key))
    if (reason) push(mode === 'production' ? errors : warnings, key, reason)
  }

  // Reutilización de secretos: APP_SECRET firma JWT, APP_ENCRYPTION_KEY cifra
  // credenciales de integraciones; compartirlos amplifica cualquier fuga.
  const appSecret = get('APP_SECRET')
  const encKey = get('APP_ENCRYPTION_KEY')
  if (appSecret && encKey && appSecret === encKey) {
    push(mode === 'production' ? errors : warnings, 'APP_ENCRYPTION_KEY', 'idéntico a APP_SECRET (deben ser secretos distintos)')
  }

  // ---------- Opcionales con requisito de fortaleza SI están ----------
  const verifyToken = get('WHATSAPP_VERIFY_TOKEN')
  if (!verifyToken) {
    push(warnings, 'WHATSAPP_VERIFY_TOKEN', 'no configurado: los webhooks de WhatsApp entrantes no validarán')
  } else {
    const reason = weakSecretReason(verifyToken)
    if (reason) push(mode === 'production' ? errors : warnings, 'WHATSAPP_VERIFY_TOKEN', reason)
  }

  const cronSecret = get('CRON_SECRET')
  if (cronSecret) {
    const reason = weakSecretReason(cronSecret)
    if (reason) push(mode === 'production' ? errors : warnings, 'CRON_SECRET', reason)
  }

  return { mode, ok: errors.length === 0, errors, warnings }
}

/**
 * Valida y LANZA en producción si hay errores (fail-fast del arranque).
 * En desarrollo solo emite warnings por consola. Devuelve el reporte.
 */
export function assertEnvForProduction(): EnvReport {
  const mode: EnvMode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const report = validateEnv(mode)

  for (const w of report.warnings) {
    console.warn(`[env-guard] AVISO (${mode}): ${w.key} → ${w.problem}`)
  }
  for (const e of report.errors) {
    console.error(`[env-guard] ERROR (${mode}): ${e.key} → ${e.problem}`)
  }

  if (mode === 'production' && !report.ok) {
    const detail = report.errors.map((e) => `${e.key}: ${e.problem}`).join('; ')
    throw new Error(
      `[env-guard] ARRANQUE BLOQUEADO en producción: secretos de entorno inválidos (${detail}). ` +
        `Genera secretos fuertes con "openssl rand -hex 32" (uno distinto por servicio) y revisa .env.example.`
    )
  }
  return report
}
