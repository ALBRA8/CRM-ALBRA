# Pendientes

## Crítico — aislamiento y seguridad

### P0.1 — WhatsApp Baileys multi-organización
- [x] Implementación y pruebas reportadas: sesiones por org, credenciales aisladas, validación de orgId, rutas con alcance por organización y proxy CRM ligado al JWT.
- [ ] Verificar independientemente el diff y el commit c2f4001 en ALBRA8/CRM-ALBRA.
- [ ] Confirmar que main y fix/saas-security-and-stabilization apuntan al commit esperado y que stable-production sigue intacta en ea87cc2.
- [ ] Repetir pruebas de aislamiento y revisar persistencia, reconexión, eventos, migración y compatibilidad de /send sin orgId.

### P0.2 — Ejecuciones del Doctor
- [ ] Auditar todas las rutas y servicios que leen o modifican ejecuciones.
- [ ] Derivar orgId de la sesión/JWT validado, nunca del body/query del cliente.
- [ ] Comprobar ownership también en relaciones, agentes, conversaciones, tareas, reintentos y operaciones masivas.
- [ ] Denegar acceso cruzado con 403/404 sin filtrar existencia de recursos.
- [ ] Añadir pruebas positivas y negativas entre tenants y por rol.

### P0.3 — Endpoint público /api/nicho
- [ ] Definir y documentar qué operaciones deben ser públicas.
- [ ] Impedir que orgId/organizationId/slug del cliente concedan acceso a datos privados de otro tenant.
- [ ] Resolver organización autenticada desde identidad validada; limitar acceso anónimo a datos públicos explícitos.
- [ ] Probar manipulación de identificadores, enumeración, abuso y rate limiting.

### P0.4 — Secretos inseguros
- [ ] Auditar .env.example, configuración, Docker, scripts, workflows y documentación.
- [ ] Sustituir secretos predeterminados por marcadores no funcionales.
- [ ] Fallar de forma segura al iniciar en producción si faltan secretos o son débiles/conocidos.
- [ ] Revisar historial y rotar credenciales reales que hayan podido exponerse.
- [ ] Añadir pruebas automáticas para detectar secretos inseguros.

## Alto — multicuenta
- [ ] Diseñar entidad de conexiones multi-cuenta por organización.
- [ ] Migrar Integration uno-a-uno sin perder configuración.
- [ ] Revisar si la implementación P0.1 resuelve únicamente sesiones WhatsApp por organización o también el modelo general de múltiples cuentas/canales.
- [ ] Definir OAuth/renovación/revocación Instagram.
- [ ] Adaptar WhatsApp Cloud y Telegram al modelo multi-cuenta.
- [ ] Evaluar Facebook Messenger si continúa en alcance.

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

## Trabajo de tests Windows/.env — pendiente de atribución
- [ ] Identificar en cuál de los tres repositorios (CRM-ALBRA, WHATSPOWER o WHATSPOWER-ULTRA) se creó el commit local 658740b.
- [ ] Verificar que el patch no contiene .env, secretos ni archivos generados.
- [ ] No aplicar el patch ni publicar el commit hasta confirmar repositorio, rama y estado del remoto.
- [ ] Ejecutar la suite en Windows real con el .env local sin exponer su contenido.
- [ ] Identificar y verificar individualmente los tres fallos originales que no quedaron explicados en el informe.

Cerrar cada pendiente con commit/PR, evidencia de pruebas y revisión de seguridad; no basta con código parcial. No desplegar sin autorización expresa.
