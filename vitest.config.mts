import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Mismo alias '@' que tsconfig (paths) para reutilizar los imports de src/
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  test: {
    // Backend puro (rutas API + libs): sin DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/env.ts'],
    // Timeouts generosos: prisma db push + seed corren en cada archivo de test.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // La BD de prueba es un único archivo SQLite (db/test-vitest.db) que se
    // recrea por archivo de test: ejecutar en serie evita condiciones de carrera.
    fileParallelism: false,
  },
})
