/**
 * Currency utility - reads the active currency from localStorage
 * (set from Settings > Negocio). Falls back to COP for backward compatibility.
 */

export type CurrencyCode = 'COP' | 'USD' | 'MXN' | 'EUR' | 'ARS' | 'PEN' | 'CLP' | 'BRL'

interface CurrencyInfo {
  code: CurrencyCode
  symbol: string
  locale: string
  label: string
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  COP: { code: 'COP', symbol: '$', locale: 'es-CO', label: 'Peso Colombiano (COP)' },
  USD: { code: 'USD', symbol: '$', locale: 'en-US', label: 'Dólar EE.UU. (USD)' },
  MXN: { code: 'MXN', symbol: '$', locale: 'es-MX', label: 'Peso Mexicano (MXN)' },
  EUR: { code: 'EUR', symbol: '€', locale: 'es-ES', label: 'Euro (EUR)' },
  ARS: { code: 'ARS', symbol: '$', locale: 'es-AR', label: 'Peso Argentino (ARS)' },
  PEN: { code: 'PEN', symbol: 'S/', locale: 'es-PE', label: 'Sol Peruano (PEN)' },
  CLP: { code: 'CLP', symbol: '$', locale: 'es-CL', label: 'Peso Chileno (CLP)' },
  BRL: { code: 'BRL', symbol: 'R$', locale: 'pt-BR', label: 'Real Brasileño (BRL)' },
}

const STORAGE_KEY = 'crm-albra-currency'
const DEFAULT_CURRENCY: CurrencyCode = 'COP'

let activeCurrency: CurrencyCode = DEFAULT_CURRENCY
let listeners: Array<() => void> = []

// Initialize from localStorage (client-side only)
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as CurrencyCode | null
    if (saved && CURRENCIES[saved]) {
      activeCurrency = saved
    }
  } catch {
    // ignore
  }
}

export function getActiveCurrency(): CurrencyCode {
  return activeCurrency
}

export function setActiveCurrency(code: CurrencyCode): void {
  if (!CURRENCIES[code]) return
  activeCurrency = code
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // ignore
    }
  }
  listeners.forEach((l) => l())
}

export function subscribeCurrency(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

/**
 * Format a number using the active currency.
 * Drop-in replacement for the inline `formatCurrency` used throughout the app.
 */
export function formatCurrency(value: number): string {
  const info = CURRENCIES[activeCurrency] ?? CURRENCIES[DEFAULT_CURRENCY]
  try {
    return new Intl.NumberFormat(info.locale, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.code === 'COP' || info.code === 'CLP' ? 0 : 2,
    }).format(value)
  } catch {
    return `${info.symbol}${value.toFixed(2)}`
  }
}
