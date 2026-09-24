# Memoria Central - CRM ALBRA

## Reglas de Negocio
- La base de datos usa un Sistema de Entidades Unificado (UES). Toda persona existe una sola vez en la tabla `perfiles` (antigua entidades) identificada por su teléfono o identificador. Los roles (cliente, proveedor, profesional) se asignan en la tabla `perfil_roles`.
- NUNCA crear tablas separadas por tipo de contacto. Todo debe quedar en `perfiles` + `perfil_roles`.
- Un mismo perfil puede tener múltiples roles: alguien puede ser proveedor Y cliente a la vez.

## Herramientas del Sistema
- Usar SIEMPRE `gestionar_perfil` para registrar/buscar/eliminar personas.
- `capturar_prospecto` para ingresos al embudo CRM.
- `avanzar_etapa_oportunidad` para mover prospectos en el pipeline.

## Arquitectura
- Backend: Express.js + better-sqlite3
- Rutas API unificadas bajo `/api/perfiles`
- UI: crm_dashboard.html con vista Kanban y Panel 360

## Contexto Actual
- Sede actual: Principal, Zona horaria: UTC-5 (GMT-5)

## Notas Generales
- El modelo de AI utilizado es CRM ALBRA v1.0 Gold, un Sistema de Inteligencia Comercial avanzado.
