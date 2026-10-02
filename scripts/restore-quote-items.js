// Restaura los items extraídos como filas de la tabla QuoteItem
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const db = new PrismaClient()

async function main() {
  const rows = JSON.parse(fs.readFileSync('/home/z/my-project/scripts/quote-items-backup.json', 'utf8'))
  let total = 0
  for (const q of rows) {
    if (!q.items?.length) continue
    await db.quoteItem.createMany({
      data: q.items.map((it, i) => ({
        quoteId: q.id,
        sku: it.sku || null,
        description: it.description || '',
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        subtotal: (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
        position: i,
      })),
    })
    total += q.items.length
    console.log(`Cotización ${q.number}: ${q.items.length} items restaurados`)
  }
  console.log(`Total: ${total} items`)
}

main().finally(() => db.$disconnect())
