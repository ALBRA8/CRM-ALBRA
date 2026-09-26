'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Suscriptor nulo: "mounted" no observa una fuente externa que cambie,
// sino la diferencia servidor (false) vs cliente (true) durante la hidratación.
const emptySubscribe = () => () => {}

/**
 * Toggle minimalista de tema claro/oscuro para el header.
 * Icono Sun/Moon que alterna la clase `.dark` en <html> vía next-themes
 * (persistido en localStorage y respetando la preferencia del sistema).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // Evita mismatch de hidratación: renderiza un placeholder hasta montar.
  // getServerSnapshot=false (SSR + primera pasada de hidratación), getSnapshot=true
  // en cliente → React re-renderiza tras montar, sin setState dentro de effects.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

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
