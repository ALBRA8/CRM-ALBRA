import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * GATES DE INDEPENDENCIA DEL CHALECO CRM (misión de separación).
 *
 * El agente propietario del CRM fue ELIMINADO (/api/chat, /api/agent,
 * /app/chat, /components/chat, sendChatMessage). Este test escanea el árbol
 * src/ y falla si:
 *
 *  GATE-A — algún módulo vuelve a importar/citar los artefactos eliminados.
 *  GATE-B — algún endpoint de runtime delega en un "agente propietario"
 *           (imports de módulos inexistentes = build/runtime roto).
 *  GATE-C — desaparece una capability del chaleco (los contratos deben seguir
 *           presentes: capa de acciones, MCP, contrato de memoria, KB).
 *
 * Es un escaneo estático deliberadamente estricto: la independencia no se
 * delega a la memoria de nadie, se verifica en cada corrida de CI.
 */

const SRC_ROOT = join(__dirname, '..', '..', 'src')
const EXTS = ['.ts', '.tsx', '.mjs']

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (EXTS.some((e) => name.endsWith(e))) acc.push(full)
  }
  return acc
}

const files = walk(SRC_ROOT)
const contents = files.map((f) => ({ f, c: readFileSync(f, 'utf8') }))

describe('Independencia del CHALECO CRM (agente eliminado)', () => {
  it('GATE-A: ninguna referencia funcional a los artefactos del agente eliminado', () => {
    const forbidden: RegExp[] = [
      /from\s+['"]@\/app\/api\/chat/, // ruta eliminada
      /from\s+['"]@\/components\/chat/, // componente eliminado
      /from\s+['"]@\/app\/api\/agent\//, // ruta eliminada
      /api\.sendChatMessage\b/, // cliente eliminado
      /fetch\(\s*['"`][^'"`]*\/api\/chat/, // llamadas HTTP al agente
      /fetch\(\s*['"`][^'"`]*\/api\/agent\//, // llamadas HTTP a /api/agent
      /initialView:\s*['"]chat['"]/,
    ]
    const offenders: string[] = []
    for (const { f, c } of contents) {
      for (const re of forbidden) {
        if (re.test(c)) offenders.push(`${f} → ${re}`)
      }
    }
    expect(offenders, `Referencias al agente eliminado en:\n${offenders.join('\n')}`).toEqual([])
  })

  it('GATE-B: no existen directorios del agente en el árbol src', () => {
    const banned = [
      join(SRC_ROOT, 'app', 'api', 'chat'),
      join(SRC_ROOT, 'app', 'api', 'agent'),
      join(SRC_ROOT, 'app', 'chat'),
      join(SRC_ROOT, 'components', 'chat'),
    ]
    const present = banned.filter((p) => {
      try {
        statSync(p)
        return true
      } catch {
        return false
      }
    })
    expect(present, `Directorios del agente presentes: ${present.join(', ')}`).toEqual([])
  })

  it('GATE-C: las capabilities y contratos del chaleco siguen presentes', () => {
    const required = [
      'lib/capabilities/crm-actions.ts', // capa canónica de acciones
      'lib/mcp/tools.ts', // contrato MCP (host)
      'lib/memory-contract.ts', // contrato MemoryDV (host)
      'lib/knowledge.ts', // conocimiento del negocio
      'lib/channel-autoresponder.ts', // workflow de auto-respuesta de canales
      'app/api/crm/actions/route.ts', // contrato REST para hosts
      'app/api/whatsapp/auto-reply/route.ts', // workflow de canal WhatsApp
      'app/api/suggestions/corrections/route.ts', // auto-mejora de estilo
      'app/api/mcp/route.ts', // servidor MCP
    ]
    const missing = required.filter((rel) => {
      try {
        statSync(join(SRC_ROOT, rel))
        return false
      } catch {
        return true
      }
    })
    expect(missing, `Capabilities del chaleco ausentes: ${missing.join(', ')}`).toEqual([])
  })

  it('GATE-C2: el catálogo de acciones conserva las 6 capacidades originales', async () => {
    const mod = await import('@/lib/capabilities/crm-actions')
    const expected = ['create_client', 'create_opportunity', 'schedule_reservation', 'add_note', 'quote_summary', 'list_recent_clients']
    for (const action of expected) {
      expect(mod.CRM_ACTIONS[action], `Acción ${action} ausente del chaleco`).toBeTruthy()
    }
    const catalog = mod.crmActionsCatalog().map((a: { name: string }) => a.name)
    expect(catalog.sort()).toEqual(expected.sort())
  })
})
