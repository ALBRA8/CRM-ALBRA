/**
 * Verifica/activa la memoria vectorial del CRM (Fase 5).
 *
 * Uso:
 *   NVIDIA_KEY=nvapi-... bun run scripts/activate_vector_memory.ts
 *   (sin NVIDIA_KEY → solo diagnostico, no escribe)
 *
 * Hace:
 *  1. Diagnóstico: organizations, Settings (llm config enmascarada), conteos de
 *     ConversationEmbedding / AgentMemory / AgentCorrection (con y sin vector).
 *  2. Si hay NVIDIA_KEY: escribe Settings del primer org con baseUrl/model/embedModel
 *     y la llave cifrada con encryptSecret (AES-256-GCM, misma ruta que la UI).
 *  3. Prueba en vivo por el MISMO camino de código del CRM: embedTexts() → NVIDIA
 *     /v1/embeddings con el modelo configurado. Reporta dims y similitud coseno.
 */
import { db } from '../src/lib/db'
import { encryptSecret, decryptSecret, maskSecret } from '../src/lib/crypto'
import { embedTexts, cosine } from '../src/lib/memory'

async function main() {
  const key = process.env.NVIDIA_KEY?.trim()

  // ---------- 1) Diagnóstico ----------
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  console.log(`Organizations: ${orgs.length}`)
  for (const o of orgs) console.log(`  - ${o.name} (${o.id})`)

  if (orgs.length === 0) {
    console.log('SIN ORGS — nada que configurar.')
    return
  }
  const org = orgs[0]
  const settings = await db.settings.findUnique({ where: { organizationId: org.id } })
  const storedKey = decryptSecret(settings?.llmApiKeyEnc ?? null)
  console.log('\n--- Settings actuales (org: ' + org.name + ') ---')
  console.log('  llmBaseUrl   :', settings?.llmBaseUrl || '(vacío)')
  console.log('  llmModel     :', settings?.llmModel || '(vacío)')
  console.log('  llmEmbedModel:', settings?.llmEmbedModel || '(vacío)')
  console.log('  llmApiKey    :', storedKey ? maskSecret(storedKey) : '(vacío)')
  console.log('  provider     :', settings?.llmProvider || '(null)')

  const [frags, withVec, facts, lessons] = await Promise.all([
    db.conversationEmbedding.count({ where: { organizationId: org.id } }),
    db.conversationEmbedding.count({ where: { organizationId: org.id, NOT: { embedding: null } } }),
    db.agentMemory.count({ where: { organizationId: org.id } }),
    db.agentCorrection.count({ where: { organizationId: org.id } }),
  ])
  console.log('\n--- Memoria (hipocampo) ---')
  console.log(`  Fragmentos de conversación: ${frags} (con vector: ${withVec})`)
  console.log(`  Hechos consolidados       : ${facts}`)
  console.log(`  Lecciones de estilo       : ${lessons}`)

  // ---------- 2) Configurar si viene llave ----------
  if (key) {
    const enc = encryptSecret(key)
    if (!enc) throw new Error('No se pudo cifrar la llave (¿falta APP_SECRET/APP_ENCRYPTION_KEY?)')
    const data = {
      llmBaseUrl: 'https://integrate.api.nvidia.com/v1',
      llmModel: 'z-ai/glm-5.3-flash',
      llmEmbedModel: 'nvidia/nemotron-3-embed-1b',
      llmProvider: 'custom',
      llmApiKeyEnc: enc,
    }
    if (settings) {
      await db.settings.update({ where: { organizationId: org.id }, data })
    } else {
      await db.settings.create({ data: { organizationId: org.id, ...data } })
    }
    console.log('\n✔ Settings actualizados: baseUrl + modelo + embedModel + llave CIFRADA (AES-256-GCM).')
  } else {
    console.log('\n(i) Sin NVIDIA_KEY en entorno: no escribo settings (solo diagnóstico).')
  }

  // ---------- 3) Prueba en vivo del camino del CRM ----------
  console.log('\n--- Prueba en vivo embedTexts() por el código del CRM ---')
  const vectors = await embedTexts(org.id, ['cliente pregunta precio de cemento'], 'query')
  if (!vectors) {
    console.log('✗ embedTexts devolvió null → modo degradado (revisa baseUrl/llave/embedModel).')
    return
  }
  const vectors2 = await embedTexts(org.id, ['el cliente quiere saber cuánto cuesta una bolsa de cemento'], 'passage')
  if (!vectors2) {
    console.log('✗ segunda llamada falló')
    return
  }
  const simRel = cosine(vectors[0], vectors2[0])
  const vectors3 = await embedTexts(org.id, ['factura de la luz del mes pasado'], 'passage')
  const simUnrel = vectors3 ? cosine(vectors[0], vectors3[0]) : 0
  console.log(`✔ Embeddings OK: ${vectors[0].length} dims`)
  console.log(`  coseno consulta↔frase similar   : ${simRel.toFixed(3)} (esperado alto >0.6)`)
  console.log(`  coseno consulta↔frase ajena    : ${simUnrel.toFixed(3)} (esperado bajo <0.4)`)
  console.log(
    simRel > simUnrel + 0.15
      ? '✔ El contraste semántico funciona: la memoria discriminará temas.'
      : '⚠ Contraste débil: revisa el modelo de embeddings.'
  )
}

main()
  .catch((e) => {
    console.error('ERROR:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
