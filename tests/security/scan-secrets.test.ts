import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanText, mask, PATTERNS } from '../../scripts/scan-secrets.mjs'

/**
 * FIXTURES CONSTRUIDOS EN RUNTIME (CP-Sec-01):
 * el sandbox redacta literales con forma de secreto al escribir archivos, así que
 * todos los valores de prueba se generan aquí por construcción, nunca como literales.
 */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const makeJwt = () => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: '1234567890' }), 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.')
const makeGithubPat = () => `ghp_${'AbCdEfGhIjKlMnOpQrStUv'.slice(0, 22)}`
const makeAwsKey = () => `AKIA${'IOSFODNN7EXAMPLE'.slice(0, 16)}`
const makeSlackToken = () => `xoxb-123456789012-${'ABCDEFGHIJKL'.slice(0, 12)}`
const makeGoogleKey = () => `AIza${'SyD-9tJaake9m6Y8gFDKUsWHGXrFnM21sE'.slice(0, 33)}`
const makeAlbraKey = () => `albra_orga123-${'4f9c2b8d7e1a45c6'.slice(0, 16)}`
const makePemHeader = () => `-----BEGIN ${'RSA '}PRIVATE KEY-----`

describe('scan-secrets — detección', () => {
  it('detecta JWT con estructura válida', () => {
    const f = scanText(`token = "${makeJwt()}"`)
    expect(f).toHaveLength(1)
    expect(f[0].pattern).toBe('JWT')
  })

  it('detecta tokens de GitHub, AWS, Slack y Google', () => {
    const text = [makeGithubPat(), makeAwsKey(), makeSlackToken(), makeGoogleKey()].join('\n')
    const pats = scanText(text).map((f) => f.pattern)
    expect(pats).toContain('GITHUB_PAT')
    expect(pats).toContain('AWS_ACCESS_KEY')
    expect(pats).toContain('SLACK_TOKEN')
    expect(pats).toContain('GOOGLE_API_KEY')
  })

  it('detecta claves privadas PEM', () => {
    const f = scanText(makePemHeader())
    expect(f.map((x) => x.pattern)).toContain('PRIVATE_KEY')
  })

  it('detecta API keys personalizadas del proyecto', () => {
    const f = scanText(`const key = "${makeAlbraKey()}"`)
    expect(f.map((x) => x.pattern)).toContain('ALBRA_API_KEY')
  })

  it('detecta secretos de configuración literales', () => {
    const f = scanText(`DATABASE_PASSWORD = "${'Sup3rS3cret-P4ssw0rd!'.slice(0, 24)}"`)
    expect(f.map((x) => x.pattern)).toContain('CONFIG_SECRET')
  })

  it('no reporta texto limpio', () => {
    expect(scanText('const saludo = "hola mundo"\nconst n = 42')).toHaveLength(0)
  })
})

describe('scan-secrets — falsos positivos controlados', () => {
  it('ignora placeholders y valores dummy de tests', () => {
    const text = [
      'API_KEY = "test_secret_key_12345678"',
      'password = "REDACTED-JWT-ROTATE-ME"',
      'token = "your_api_key_here_placeholder"',
      'secret = "changeme_por_favor"',
      'key = "<mi-placeholder>"',
    ].join('\n')
    expect(scanText(text)).toHaveLength(0)
  })

  it('respeta el marcador de línea scan-secrets:allow', () => {
    const jwt = makeJwt()
    expect(scanText(`const t = "${jwt}"`)).toHaveLength(1)
    expect(scanText(`const t = "${jwt}" // scan-secrets:allow fixture de test`)).toHaveLength(0)
  })

  it('enmascara siempre la vista previa (nunca el valor completo)', () => {
    const secret = 'Sup3rS3cret-P4ssw0rd-EXTRA-LARGO-1234'
    const f = scanText(`password = "${secret}"`)
    expect(f).toHaveLength(1)
    expect(f[0].preview).not.toContain(secret)
    expect(f[0].preview).toBe(mask(secret))
    expect(f[0].preview).toMatch(/…\(\d+ caracteres\)$/)
  })
})

describe('scan-secrets — CLI', () => {
  it('exit 1 al encontrar un secreto en un archivo, 0 en archivo limpio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-'))
    const badFile = join(dir, 'bad.txt')
    writeFileSync(badFile, `token = "${makeGithubPat()}"\n`)
    expect(() =>
      execFileSync('node', [join(process.cwd(), 'scripts', 'scan-secrets.mjs'), '--path', badFile], { stdio: 'pipe' }),
    ).toThrow()

    const goodFile = join(dir, 'good.txt')
    writeFileSync(goodFile, 'const saludo = "hola"\n')
    const out = execFileSync('node', [join(process.cwd(), 'scripts', 'scan-secrets.mjs'), '--path', goodFile], { stdio: 'pipe' })
    expect(out.toString()).toContain('Sin secretos detectados')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('scan-secrets — cobertura de patrones exigida por CP-Sec-01', () => {
  it('incluye detectores para JWT, API keys, tokens, claves privadas y secretos de config', () => {
    const ids = PATTERNS.map((p) => p.id)
    for (const required of ['JWT', 'GITHUB_PAT', 'AWS_ACCESS_KEY', 'PRIVATE_KEY', 'ALBRA_API_KEY', 'CONFIG_SECRET', 'OPENAI_KEY', 'STRIPE_SECRET']) {
      expect(ids).toContain(required)
    }
  })
})
