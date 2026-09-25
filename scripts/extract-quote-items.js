// Extrae los items JSON de las cotizaciones existentes antes de migrar a tabla QuoteItem
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const db = new PrismaClient()

async function main() {
  const quotes = await db.quote.findMany({ select: { id: true, number: true, items: true } })
  const rows = quotes.map((q) => ({ id: q.id, number: q.number, items: JSON.parse(q.items || '[]') }))
  fs.writeFileSync('/home/z/my-project/scripts/quote-items-backup.json', JSON.stringify(rows, null, 2))
  console.log(`Extraídas ${rows.length} cotizaciones → scripts/quote-items-backup.json`)
  for (const r of rows) console.log(`  ${r.number}: ${r.items.length} items`)
}

main().finally(() => db.$disconnect())
