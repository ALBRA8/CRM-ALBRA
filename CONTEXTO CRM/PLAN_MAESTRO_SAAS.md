# Plan maestro de evolución SaaS

## Objetivo
Convertir CRM ALBRA en SaaS multiempresa y multicuenta, preservando capacidades actuales y autonomía de los productos relacionados. Este documento es un plan; ninguna fase queda completada por estar escrita.

## Fase 0 — Línea base
Inventario de módulos, endpoints, modelos e integraciones; matriz tenant; pruebas base; commit estable; estrategia de ramas, migraciones y rollback.
**Salida:** informe reproducible y sin defectos críticos de aislamiento.

## Fase 1 — Tenancy y persistencia
Auditar todas las consultas, mutaciones, relaciones, tareas, exportaciones y archivos; índices/restricciones compuestos; pruebas negativas entre tenants; elegir y ensayar migración desde SQLite a motor de producción.
**Salida:** suite de aislamiento y migración ensayada.

## Fase 2 — Conexiones multi-cuenta
Diseñar ChannelConnection (nombre provisional) con organización, canal, proveedor, externalAccountId, estado, permisos, credencial cifrada y ciclo de vida. Soportar N cuentas del mismo canal por organización. Migrar Integration con compatibilidad transitoria.
**Salida:** varias cuentas conectadas y aisladas en una misma organización.

## Fase 3 — Webhooks y eventos
Resolver por ID externo exacto; verificar firma; rechazar destinos ambiguos; idempotencia, deduplicación, reintentos, trazas y dead-letter queue.
**Salida:** todo evento se asocia a una conexión inequívoca o se rechaza.

## Fase 4 — WhatsApp multicuenta
Reemplazar estado de sesión única por orquestador; auth state separado por conexión; asociación conexión-organización-número; reconexión, recuperación, límites y pruebas concurrentes. Mantener Cloud API separada de Baileys.
**Salida:** varias sesiones simultáneas sin cruces y con recuperación probada.

## Fase 5 — Instagram, Messenger y otros canales
OAuth y renovación de Instagram; matching estricto; evaluar Messenger (Page ID, permisos, webhook y envío); adaptar Telegram y WhatsApp Cloud al modelo multi-cuenta.
**Salida:** ciclo conectar/desconectar para múltiples cuentas y webhooks inequívocos.

## Fase 6 — SaaS comercial
Onboarding, invitaciones, roles, planes, cuotas, medición, suscripciones, pagos, soporte auditado, privacidad, retención y exportación/eliminación.
**Salida:** cliente nuevo se registra, configura y opera sin intervención técnica manual.

## Fase 7 — Operación y escala
Métricas, logs, tracing, alertas, colas, rate limits por tenant, backups, restauración, RPO/RTO, carga, gestión de secretos e incidentes.
**Salida:** SLO, capacidad y recuperación demostrados.

## Fase 8 — Ecosistema ALBRA
Contratos API/eventos versionados con WhatsPower, Comuniti Manager y Browser Factory; autorización, firma, idempotencia y fallos aislados; cada producto conserva autonomía.
**Salida:** integración probada sin acoplamiento innecesario.

## Orden recomendado
0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6; seguridad, observabilidad y resiliencia son transversales. Fase 8 avanza cuando los contratos estén definidos.

## Regla de avance
Cada cambio requiere alcance, decisión, migración/rollback, pruebas unitarias e integración, pruebas de aislamiento, revisión de seguridad, documentación y evidencia en commit/PR. No reescribir todo ni declarar multicuenta/producción sin pruebas reales.
