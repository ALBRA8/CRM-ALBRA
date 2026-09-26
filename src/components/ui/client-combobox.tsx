'use client'

/**
 * ClientCombobox — selector de cliente con búsqueda multi-campo.
 *
 * Motivación (petición del usuario): el desplegable plano de "Nueva Oportunidad"
 * era insostenible con muchos clientes. Ahora se busca por NOMBRE, TELÉFONO,
 * CÉDULA/DNI o CORREO, con dos niveles:
 *
 *  1. LOCAL (instantáneo): filtra la lista ya cargada con clientMatchesQuery()
 *     (texto normalizado: minúsculas, sin tildes, teléfono solo dígitos).
 *  2. SERVIDOR (opcional, debounced 300ms): si el org tiene más clientes de los
 *     cargados, `remoteSearch` consulta GET /clients?search=... (que busca en
 *     name/email/phone/cedula) y los resultados se MERGEAN sin duplicar.
 *
 * Reutilizable: acepta props, no acopla a la API (el caller pasa remoteSearch).
 */

import { useEffect, useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, User } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ClientOption {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  cedula?: string | null
}

interface ClientComboboxProps {
  clients: ClientOption[]
  value: string
  onChange: (clientId: string) => void
  placeholder?: string
  disabled?: boolean
  /** Búsqueda server-side (GET /clients?search=…) para orgs con muchos clientes. */
  remoteSearch?: (query: string) => Promise<ClientOption[]>
}

/** Normaliza para comparar: minúsculas, sin tildes, colapsa espacios. */
export function normalizeSearchText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** El teléfono puede venir con +, espacios o guiones: compara solo dígitos. */
function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '')
}

/** ¿El cliente coincide con la query (nombre, teléfono, cédula o correo)? */
export function clientMatchesQuery(client: ClientOption, rawQuery: string): boolean {
  const query = normalizeSearchText(rawQuery)
  if (!query) return true

  const name = normalizeSearchText(client.name)
  const email = normalizeSearchText(client.email)
  const cedula = normalizeSearchText(client.cedula)
  const queryDigits = digitsOnly(query)

  // Coincidencia por texto (nombre/email/cédula; teléfono también en texto
  // por si buscan "3001 11" con espacios).
  const textHit =
    name.includes(query) ||
    email.includes(query) ||
    cedula.includes(query) ||
    normalizeSearchText(client.phone).includes(query)

  // Coincidencia por dígitos (teléfono o cédula escritos con/sin formato:
  // "+57 300 111-2233" encuentra a "3001112233").
  const digitHit =
    queryDigits.length >= 3 &&
    (digitsOnly(client.phone).includes(queryDigits) || digitsOnly(client.cedula).includes(queryDigits))

  return textHit || digitHit
}

/** Línea secundaria del ítem: teléfono · cédula · correo (lo que exista). */
export function clientSecondaryLine(client: ClientOption): string {
  return [client.phone, client.cedula, client.email].filter((v): v is string => !!v && v.trim() !== '').join(' · ')
}

export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = 'Seleccionar cliente',
  disabled,
  remoteSearch,
}: ClientComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [remoteClients, setRemoteClients] = useState<ClientOption[]>([])
  const selected = useMemo(() => clients.find((c) => c.id === value) ?? null, [clients, value])

  // Reset del buscador al abrir (evento, no efecto: el linter de hooks prohíbe
  // setState síncrono en effects y esto además es más directo).
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setSearch('')
      setRemoteClients([])
    }
  }

  // Búsqueda server-side con debounce: solo si el caller la provee y la query
  // tiene al menos 2 caracteres (evita martillar /clients con "a"). El setState
  // vive dentro del timer (asíncrono), no en el cuerpo del efecto.
  useEffect(() => {
    if (!remoteSearch || !open) return
    const q = search.trim()
    const timer = setTimeout(() => {
      if (q.length < 2) {
        setRemoteClients([])
        return
      }
      remoteSearch(q)
        .then((results) => setRemoteClients(Array.isArray(results) ? results : []))
        .catch(() => setRemoteClients([])) // fallo de red: queda la búsqueda local
    }, 300)
    return () => clearTimeout(timer)
  }, [search, open, remoteSearch])

  // Merge sin duplicados: local primero (orden de carga), remoto detrás.
  const visibleClients = useMemo(() => {
    const base = search.trim() ? clients.filter((c) => clientMatchesQuery(c, search)) : clients
    const seen = new Set(base.map((c) => c.id))
    const extra = remoteClients.filter((c) => !seen.has(c.id))
    return [...base, ...extra]
  }, [clients, remoteClients, search])

  const handleSelect = (clientId: string) => {
    onChange(clientId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nombre, teléfono, cédula o correo..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            {visibleClients.length === 0 ? (
              <CommandEmpty>
                {search.trim() ? `Sin resultados para "${search.trim()}"` : 'No hay clientes aún'}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {visibleClients.map((client) => {
                  const secondary = clientSecondaryLine(client)
                  return (
                    <CommandItem
                      key={client.id}
                      value={client.id}
                      onSelect={() => handleSelect(client.id)}
                      className="py-2"
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 flex-shrink-0',
                          value === client.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.name}</p>
                        {secondary && <p className="text-xs text-slate-400 truncate">{secondary}</p>}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
