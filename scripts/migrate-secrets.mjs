#!/usr/bin/env node
/**
 * migrate-secrets.mjs — Migrador seguro de secretos en reposo (AES-256-GCM).
 *
 * Revisa tablas críticas con secretos (WhatsAppConnection, Integration, User, Settings)
 * y re-encripta cualquier valor heredado en texto plano que no tenga el prefijo 'v1:'.
 * No modifica valores ya cifrados.
 */
import { PrismaClient } from '@prisma/client'
import { isLegacyPlaintext, migrateSecret } from '../src/lib/crypto.js'

const prisma = new PrismaClient()

async function main() {
  console.log('[migrate-secrets] Iniciando escaneo de secretos heredados...')
  let migratedCount = 0

  // 1. WhatsAppConnection
  const connections = await prisma.whatsAppConnection.findMany({
    select: { id: true, accessTokenEnc: true, metaAppSecretEnc: true }
  })
  for (const conn of connections) {
    const updates = {}
    if (isLegacyPlaintext(conn.accessTokenEnc)) {
      const res = migrateSecret(conn.accessTokenEnc)
      if (res.encrypted) updates.accessTokenEnc = res.encrypted
    }
    if (conn.metaAppSecretEnc && isLegacyPlaintext(conn.metaAppSecretEnc)) {
      const res = migrateSecret(conn.metaAppSecretEnc)
      if (res.encrypted) updates.metaAppSecretEnc = res.encrypted
    }
    if (Object.keys(updates).length > 0) {
      await prisma.whatsAppConnection.update({ where: { id: conn.id }, data: updates })
      migratedCount++
    }
  }

  // 2. Integration
  const integrations = await prisma.integration.findMany({
    select: {
      id: true,
      telegramBotTokenEnc: true,
      instagramTokenEnc: true,
      googleRefreshTokenEnc: true,
      googleClientJsonEnc: true,
      metaAppSecretEnc: true,
      whatsappCloudTokenEnc: true,
      agentLeadsSecretEnc: true,
      facebookTokenEnc: true,
      tiktokTokenEnc: true
    }
  })
  for (const itg of integrations) {
    const updates = {}
    const fields = [
      'telegramBotTokenEnc', 'instagramTokenEnc', 'googleRefreshTokenEnc',
      'googleClientJsonEnc', 'metaAppSecretEnc', 'whatsappCloudTokenEnc',
      'agentLeadsSecretEnc', 'facebookTokenEnc', 'tiktokTokenEnc'
    ]
    for (const f of fields) {
      if (itg[f] && isLegacyPlaintext(itg[f])) {
        const res = migrateSecret(itg[f])
        if (res.encrypted) updates[f] = res.encrypted
      }
    }
    if (Object.keys(updates).length > 0) {
      await prisma.integration.update({ where: { id: itg.id }, data: updates })
      migratedCount++
    }
  }

  // 3. User (twoFactorSecret)
  const users = await prisma.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { id: true, twoFactorSecret: true }
  })
  for (const user of users) {
    if (user.twoFactorSecret && isLegacyPlaintext(user.twoFactorSecret)) {
      const res = migrateSecret(user.twoFactorSecret)
      if (res.encrypted) {
        await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: res.encrypted } })
        migratedCount++
      }
    }
  }

  // 4. Settings (llmApiKeyEnc, vapidPrivateKeyEnc, smtpPassEnc)
  const settings = await prisma.settings.findMany({
    select: { id: true, llmApiKeyEnc: true, vapidPrivateKeyEnc: true, smtpPassEnc: true }
  })
  for (const s of settings) {
    const updates = {}
    if (s.llmApiKeyEnc && isLegacyPlaintext(s.llmApiKeyEnc)) {
      const res = migrateSecret(s.llmApiKeyEnc)
      if (res.encrypted) updates.llmApiKeyEnc = res.encrypted
    }
    if (s.vapidPrivateKeyEnc && isLegacyPlaintext(s.vapidPrivateKeyEnc)) {
      const res = migrateSecret(s.vapidPrivateKeyEnc)
      if (res.encrypted) updates.vapidPrivateKeyEnc = res.encrypted
    }
    if (s.smtpPassEnc && isLegacyPlaintext(s.smtpPassEnc)) {
      const res = migrateSecret(s.smtpPassEnc)
      if (res.encrypted) updates.smtpPassEnc = res.encrypted
    }
    if (Object.keys(updates).length > 0) {
      await prisma.settings.update({ where: { id: s.id }, data: updates })
      migratedCount++
    }
  }

  console.log(`[migrate-secrets] Finalizado con éxito. Registros migrados: ${migratedCount}`)
}

main()
  .catch((err) => {
    console.error('[migrate-secrets] Error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
