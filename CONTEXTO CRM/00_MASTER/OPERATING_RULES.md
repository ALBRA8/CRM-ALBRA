# Reglas operativas y continuidad
## Lectura obligatoria
README → PROJECT_STATE → ARCHITECTURE → REPOSITORY_REGISTRY → ROADMAP → decisiones e índices relevantes.

## Antes de trabajar
Identificar repo, rama y SHA; comprobar PR/árbol; no sobrescribir trabajo; leer contratos y docs locales; delimitar si la tarea es documental, código, datos, despliegue o seguridad; confirmar tenant scope y dependencias.

## Durante
No mezclar commits entre repos. No incluir secretos, tokens, PII ni .env. No inferir funcionamiento por README/endpoint. Distinguir E2E real de stubs. Registrar rama, commit, archivos, comandos, resultados y límites. Ante discrepancias, conservar fuentes y registrar conflicto. Cambiar decisiones mediante autorización y DEC log.

## Cierre
Actualizar estado, hallazgos, pruebas y pendientes; clasificar VERIFIED/REPORTED; conservar historia; entregar resumen y PR/commit. No declarar producción estable sin seguridad, health, backup/restore y pruebas operativas.

Este contexto no autoriza despliegues, migraciones destructivas, force-push, rotación de secretos ni cambios de arquitectura.
