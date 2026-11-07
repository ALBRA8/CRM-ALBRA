# Módulo: WHATSPOWER-ULTRA — Watson
**Repo:** [ALBRA8/WHATSPOWER-ULTRA](https://github.com/ALBRA8/WHATSPOWER-ULTRA) · Fuentes: README, CONTEXT y FICHA consultados 2026-11-07.

## Propósito/capacidades declaradas
Campaign Studio, CSV, validación/deduplicación, spintax, cadencia, anti-fatiga, supresión, locks JIT, cola persistente y recuperación.

## Responsabilidades/límites
Gestiona campañas/audiencias/cola propia; aplica consentimiento, opt-out, throttling y salvaguardas; delega despacho al daemon CRM autorizado; mantiene trazabilidad. No es CRM ni propietario de clientes; no gestiona diálogo 1:1 ni es agente principal; puede operar con CRM sin WP. Consulta de locks a WP es opcional.

## Configuración discrepante
README describe Suite Completa con WHATSPOWER_ENABLED=true y standalone con false. El default true debe contrastarse con runtime: WP debe ser opcional, sin dependencia oculta.

## Documentación histórica
CONTEXT.md registra pilotos de octubre 2026; FICHA.md contiene diseño temprano y contratos que pueden diferir del runtime. No tratar como estado actual.

## Pendiente
Fijar SHA; contrastar README/CONTEXT/FICHA/.env.example/runtime; probar standalone sin llamadas a WP; verificar tenant identity, despacho, guard y persistencia.
