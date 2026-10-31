# Pendientes

## Crítico — aislamiento y seguridad
- [ ] Auditar cada API route/server action por tenant context.
- [ ] Validar ownership de relaciones entre organizaciones.
- [ ] Hacer obligatorio el ID exacto de cuenta en webhook Instagram.
- [ ] Rechazar webhooks ambiguos y probar spoofing/replay/duplicados.
- [ ] Revisar autenticación, HMAC y exposición del puente WHATSPOWER.
- [ ] Añadir pruebas negativas de aislamiento entre tenants.

## Alto — multicuenta
- [ ] Diseñar entidad de conexiones multi-cuenta por organización.
- [ ] Migrar Integration uno-a-uno sin perder configuración.
- [ ] Diseñar orquestador de sesiones Baileys y auth state separado.
- [ ] Probar varias sesiones y organizaciones concurrentes.
- [ ] Definir OAuth/renovación/revocación Instagram.
- [ ] Evaluar Facebook Messenger si continúa en alcance.
- [ ] Adaptar WhatsApp Cloud y Telegram al modelo multi-cuenta.

## Alto — SaaS y operación
- [ ] Elegir motor de producción y ensayar migración desde SQLite.
- [ ] Definir onboarding, invitaciones y recuperación.
- [ ] Definir planes, cuotas, medición y facturación.
- [ ] Definir retención, exportación y eliminación.
- [ ] Definir observabilidad, alertas, SLO, RPO y RTO.
- [ ] Ejecutar restauraciones y pruebas de carga reproducibles.

## Medio — calidad/ecosistema
- [ ] Inventario de endpoints, modelos y permisos.
- [ ] Matriz de capacidades por canal.
- [ ] Revisar idempotencia, reintentos y dead-letter queue.
- [ ] Contratos versionados entre productos ALBRA.
- [ ] Confirmar estado de ramas de evolución.

Cerrar cada pendiente con commit/PR, evidencia de pruebas y revisión de seguridad; no basta con código parcial.
