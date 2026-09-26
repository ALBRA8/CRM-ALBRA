'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Toggle minimalista de tema claro/oscuro para el header.
 * Icono Sun/Moon que alterna la clase `.dark` en <html> vía next-themes
 * (persistido en localStorage y respetando la preferencia del sistema).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Evita mismatch de hidratación: renderiza un placeholder hasta montar
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="w-8 h-8" aria-hidden />
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="h-8 w-8 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  )
}
