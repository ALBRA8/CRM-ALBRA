import { afterEach, describe, expect, it, vi } from 'vitest'
import { getActiveCurrency, setActiveCurrency, subscribeCurrency, formatCurrency, CURRENCIES, type CurrencyCode } from '@/lib/currency'

/**
 * Tests unitarios de src/lib/currency.ts — moneda activa global del negocio.
 * En entorno node no hay localStorage: la moneda vive en memoria (default COP).
 */

afterEach(() => {
  setActiveCurrency('COP')
})

describe('moneda activa', () => {
  it('el default es COP (compatibilidad hacia atrás)', () => {
    expect(getActiveCurrency()).toBe('COP')
  })

  it('setActiveCurrency cambia la moneda activa', () => {
    setActiveCurrency('USD')
    expect(getActiveCurrency()).toBe('USD')
    setActiveCurrency('EUR')
    expect(getActiveCurrency()).toBe('EUR')
  })

  it('ignora códigos desconocidos sin lanzar', () => {
    setActiveCurrency('USD')
    setActiveCurrency('XXX' as CurrencyCode)
    expect(getActiveCurrency()).toBe('USD')
  })

  it('el catálogo incluye las 8 monedas soportadas con símbolo y locale', () => {
    const codes = Object.keys(CURRENCIES) as CurrencyCode[]
    expect(codes.sort()).toEqual(['ARS', 'BRL', 'CLP', 'COP', 'EUR', 'MXN', 'PEN', 'USD'].sort())
    for (const code of codes) {
      expect(CURRENCIES[code].symbol.length).toBeGreaterThan(0)
      expect(CURRENCIES[code].locale).toBeTruthy()
    }
  })
})

describe('formatCurrency', () => {
  it('formatea con la locale de la moneda activa (USD → en-US)', () => {
    setActiveCurrency('USD')
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('COP usa separador de miles es-CO (puntos)', () => {
    setActiveCurrency('COP')
    const formatted = formatCurrency(1234500)
    expect(formatted).toContain('1.234.500')
  })

  it('EUR usa el símbolo €', () => {
    setActiveCurrency('EUR')
    expect(formatCurrency(99.9)).toContain('€')
  })
})

describe('subscribeCurrency (patrón pub/sub del selector global)', () => {
  it('notifica a los suscriptores al cambiar la moneda', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCurrency(listener)
    setActiveCurrency('USD')
    expect(listener).toHaveBeenCalledTimes(1)
    setActiveCurrency('USD') // mismo valor: sigue notificando (comportamiento actual)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('la cancelación de suscripción deja de notificar', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCurrency(listener)
    unsubscribe()
    setActiveCurrency('MXN')
    expect(listener).not.toHaveBeenCalled()
  })
})
