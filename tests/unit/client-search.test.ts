import { describe, expect, it } from 'vitest'
import { clientMatchesQuery, clientSecondaryLine, normalizeSearchText, type ClientOption } from '@/components/ui/client-combobox'

/**
 * Unit: lógica de búsqueda del combobox de clientes (Nueva Oportunidad).
 * El usuario pidió buscar por nombre, teléfono, DNI/cédula o correo —
 * con tolerancia a tildes y a formato del teléfono (+57, espacios, guiones).
 */

const ALPHA: ClientOption = {
  id: 'c1',
  name: 'María González',
  phone: '+57 300 111-0000',
  cedula: 'CC-1023456789',
  email: 'maria@gonzalez.co',
}

const BETA: ClientOption = { id: 'c2', name: 'José Álvarez', phone: null, cedula: null, email: null }

describe('normalizeSearchText', () => {
  it('minúsculas, sin tildes y colapsa espacios', () => {
    expect(normalizeSearchText('  María   Gónzález ')).toBe('maria gonzalez')
  })

  it('manipula null/undefined sin lanzar', () => {
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText(undefined)).toBe('')
  })
})

describe('clientMatchesQuery', () => {
  it('coincide por nombre parcial (sin tildes en la query también)', () => {
    expect(clientMatchesQuery(ALPHA, 'maría gonz')).toBe(true)
    expect(clientMatchesQuery(BETA, 'jose alv')).toBe(true) // Álvarez → alvarez
  })

  it('coincide por correo', () => {
    expect(clientMatchesQuery(ALPHA, 'gonzalez.co')).toBe(true)
    expect(clientMatchesQuery(ALPHA, 'MARIA@')).toBe(true)
  })

  it('coincide por teléfono CON formato distinto (dígitos)', () => {
    expect(clientMatchesQuery(ALPHA, '+57 300 111')).toBe(true)
    expect(clientMatchesQuery(ALPHA, '3001110000')).toBe(true) // sin formato
    expect(clientMatchesQuery(ALPHA, '300-111-00')).toBe(true) // con guiones
  })

  it('coincide por cédula/DNI (con y sin prefijo CC-)', () => {
    expect(clientMatchesQuery(ALPHA, 'CC-1023456789')).toBe(true)
    expect(clientMatchesQuery(ALPHA, '1023456789')).toBe(true) // solo dígitos
  })

  it('NO coincide con texto ajeno al cliente', () => {
    expect(clientMatchesQuery(ALPHA, 'pedro')).toBe(false)
    expect(clientMatchesQuery(ALPHA, '9999999')).toBe(false)
  })

  it('queries cortas de dígitos (<3) no disparan la rama numérica', () => {
    // "12" podría falsamente empatar con cualquier teléfono: exige >=3 dígitos
    expect(clientMatchesQuery(ALPHA, '12')).toBe(false)
  })

  it('query vacía = coincide todo (lista completa)', () => {
    expect(clientMatchesQuery(ALPHA, '')).toBe(true)
    expect(clientMatchesQuery(ALPHA, '   ')).toBe(true)
  })
})

describe('clientSecondaryLine', () => {
  it('une teléfono · cédula · correo en ese orden', () => {
    expect(clientSecondaryLine(ALPHA)).toBe('+57 300 111-0000 · CC-1023456789 · maria@gonzalez.co')
  })

  it('omite los campos vacíos/null', () => {
    expect(clientSecondaryLine(BETA)).toBe('')
    expect(clientSecondaryLine({ id: 'c3', name: 'X', phone: '123', cedula: null, email: 'x@y.z' })).toBe('123 · x@y.z')
  })
})
