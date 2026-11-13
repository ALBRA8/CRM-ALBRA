# Mapa del sistema
```text
                 ECOSISTEMA ALBRA
                       |
                CRM-ALBRA (core)
       dominio · organizaciones · RBAC · identidad
        auditoría · contratos · agente principal*
                 /                 \
                /                   \
 WHATSPOWER (ManyChat)       WHATSPOWER-ULTRA (Watson)
 flujos conversacionales     campañas y difusión
 store operativo propio      cola/store operativo propio
          |                         |
    REST/HMAC/API key          HTTP daemon autorizado
          |                         |
          +--------- CRM -----------+
                       |
                WhatsApp daemon CRM
* Regla del propietario; conflicto con docs/HARNESS sobre agente actual.
```

| Origen | Destino | Relación descrita | Certeza |
|---|---|---|---|
| CRM | WP | inbound firmado y stage-change en informe integración | REPORTED; revalidar HEAD |
| WP | CRM | acciones REST/API key | DOCUMENTED |
| ULTRA | daemon CRM | despacho HTTP autenticado | DOCUMENTED; ejecución no reproducida |
| ULTRA | WP | locks/supresión opcionales; standalone declarado | DOCUMENTED; opcionalidad pendiente |
| CRM | ULTRA directo | informe legado dice que no había contrato | NOT ESTABLISHED |

Puertos locales de READMEs (:3000, :3002, :3003, :3004) son referencias de desarrollo, no prueba de despliegue. CRM sigue operativo sin módulos; WP y ULTRA no dependen mutuamente.
