
## Arquitectura Operativa UnoGO

### Índice
- [Visión general](#visión-general)
- [Capas de la plataforma](#capas-de-la-plataforma)
- [Flujo de eventos](#flujo-de-eventos)
- [Configuración de entornos](#configuración-de-entornos)
- [Proceso de despliegue](#proceso-de-despliegue)
- [Observabilidad y métricas](#observabilidad-y-métricas)
- [Respuesta ante incidentes](#respuesta-ante-incidentes)
- [Comandos conversacionales](#comandos-conversacionales)
- [Retención de datos y mantenimiento](#retención-de-datos-y-mantenimiento)
- [Integraciones externas](#integraciones-externas)
- [Anexos y próximos pasos](#anexos-y-próximos-pasos)

### Visión general
- **Objetivo**: Orquestar conversaciones de WhatsApp con memoria persistente usando servicios desacoplados.
- **Componentes principales**: `@unogo/web-gateway` (Next.js), workers en Railway (`services/orchestrator`, `services/llm-bridge`, `services/notifications`), Redis Upstash vía `@unogo/events`, y adaptadores `@unogo/channels-whatsapp`, `@unogo/topics`, `@unogo/shared`.
- **Principios**: Arquitectura asíncrona, modularidad por capas, observabilidad centralizada y configuración mediante variables de entorno.

### Capas de la plataforma

#### Capa 1 · Interfaz y Entrada — `@unogo/web-gateway` (Vercel)
- **Rol**: Punto de entrada HTTP (webhooks + UI).
- **Responsabilidades**:
  - **Validación**: `WhatsAppInbound.verifySignature()` con `META_APP_SECRET`.
  - **Normalización**: `WhatsAppInbound.parseInbound()` unifica `from`/`to` usando metadatos (contactos y `metadata.phone_number_id`).
  - **Encolado**: publica eventos `channel.message.received` usando `@unogo/events.add()`.
- **Resultado**: Todo mensaje entrante se transforma en evento listo para los workers.

#### Capa 2 · Procesamiento Conversacional — `services/orchestrator` (Railway)
- **Rol**: Cerebro de lógica de negocio y routing de temas.
- **Responsabilidades**:
  - **Consumo**: lee `channel.message.received`.
  - **Contexto**: usa `detectOrCreateTopic()` y `getContext()` para mantener temas y memoria.
  - **Control**: aplica `STRICT_REPLY_WINDOW_MS` y `ACK_WHEN_LATENCY_MS` para filtrar mensajes viejos y enviar ACKs opcionales.
  - **Salida**: encola `notification.send.requested` (ACKs) y `llm.reply.requested` (petición al LLM).
- **Resultado**: Mantiene coherencia conversacional y aplica comandos (`listar`, `cambiar a:`, `nuevo tema:`, `reset`).

#### Capa 3 · Generación de Respuestas — `services/llm-bridge` (Railway)
- **Rol**: Interfaz con el proveedor LLM.
- **Responsabilidades**:
  - **Consumo**: procesa `llm.reply.requested`.
  - **Invocación**: llama a `OpenAIChat.chat()` (modelo configurable vía `LLM_OPENAI_MODEL`).
  - **Persistencia**: registra turno con `appendTurn()` y actualiza resúmenes vía `setSummary()`.
  - **Publicación**: encola `llm.reply.ready`.
- **Resultado**: Devuelve respuesta lista y mantiene memoria resumida.

#### Capa 4 · Entrega de Respuestas — `services/notifications` (Railway)
- **Rol**: Canal de salida.
- **Responsabilidades**:
  - **Consumo**: atiende `llm.reply.ready` y `notification.send.requested`.
  - **Entrega**: usa `WhatsAppOutbound.sendText()` (implementar proveedor definitivo: Meta Cloud, 360dialog, Twilio, etc.).
- **Resultado**: El usuario recibe la respuesta por WhatsApp.

#### Capa 5 · Infraestructura y Conectores
- **`@unogo/events`**: Wrapper BullMQ + Upstash. Define colas `channel.message.received`, `llm.reply.requested`, `llm.reply.ready`, `notification.send.requested` con `attempts: 3` y `backoff` exponencial.
- **`@unogo/channels-whatsapp`**: Adaptador de firma, parseo y envío. Normaliza números, enmascara PII y maneja errores API.
- **`@unogo/topics`**: Gestión de historial, embeddings, resúmenes y selección de temas (con parámetros `TOPIC_*`).
- **`@unogo/shared`**: Logger centralizado y utilidades comunes.

### Flujo de eventos
```mermaid
flowchart LR
    A[WhatsApp User] -->|Webhook| B[web-gateway (Vercel)]
    B -->|channel.message.received| C[(Redis Upstash)]
    C --> D[orchestrator (Railway)]
    D -->|llm.reply.requested| C
    C --> E[llm-bridge (Railway)]
    E -->|llm.reply.ready| C
    C --> F[notifications (Railway)]
    F -->|sendText()| G[WhatsApp API]
    G -->|Delivery| A
```

### Configuración de entornos
| Variable | Servicio(s) | Descripción |
| --- | --- | --- |
| `REDIS_URL` | Todos | Endpoint Upstash (cola central). |
| `OPENAI_API_KEY` | `services/llm-bridge`, `@unogo/embeddings-openai` | Credencial para llamadas a OpenAI. |
| `LLM_OPENAI_MODEL` | `services/llm-bridge` | Modelo chat (ej. `gpt-4o-mini`). |
| `META_APP_SECRET` | `@unogo/web-gateway` | Verificación de webhook. |
| `META_WHATSAPP_TOKEN` | `@unogo/web-gateway`, `services/notifications` | Token de la API WhatsApp. |
| `META_PHONE_NUMBER_ID` | `@unogo/web-gateway`, `services/notifications` | Identificador del número registrado. |
| `TOPIC_SIM_NEW` / `TOPIC_SIM_STICKY` / `TOPIC_STICKY_WINDOW_MS` | `@unogo/topics` | Parámetros de memoria conversacional. |
| `TOPIC_HIST_SIZE` / `TOPIC_SUM_EVERY` | `@unogo/topics` | Límite de historial y frecuencia de resúmenes. |
| `STRICT_REPLY_WINDOW_MS` | `services/orchestrator` | Máxima antigüedad aceptada. |
| `ACK_WHEN_LATENCY_MS` | `services/orchestrator`, `services/notifications` | Umbral para enviar ACKs. |
| `EMBED_MODEL` / `EMBED_NORM_L2` | `@unogo/embeddings-openai` | Control de embeddings para tópicos. |

### Proceso de despliegue
- **Paso 1**: Merge en `main` activa build en Vercel (web-gateway). Verificar logs de build.
- **Paso 2**: Railway auto-deploy por branch/tag. Confirmar que `services/orchestrator`, `services/llm-bridge` y `services/notifications` levantan con nueva imagen.
- **Paso 3**: Validar variables de entorno en Vercel/Railway (mantener sincronizadas con `.env.example`).
- **Paso 4**: Ejecutar smoke test (enviar mensaje de WhatsApp y revisar colas/logs).
- **Paso 5**: Documentar cambios en `docs/deploy.md` si aplica.

### Observabilidad y métricas
- **`@unogo/web-gateway`**
  - **Log clave**: `enqueued channel.message.received`.
  - **Métrica**: tasa de entrada por minuto.
- **`services/orchestrator`**
  - **Log clave**: `Context after append` (revisar `history_len` y `topicId`).
  - **Métrica**: mensajes válidos / mensajes descartados por ventana estricta.
- **`services/llm-bridge`**
  - **Log clave**: `LLM Bridge: calling provider`.
  - **Métricas**: latencia promedio LLM, errores por rate limit.
- **`services/notifications`**
  - **Log clave**: `WhatsApp message sent`.
  - **Métrica**: ratio de éxito vs. fallos API.
- **Upstash Redis**
  - **Métrica**: longitud de colas BullMQ y operaciones por segundo.

### Respuesta ante incidentes
- **Check-list inmediata**:
  - **Verificar**: estado de Redis (disponibilidad y longitud de colas).
  - **Reiniciar**: workers en Railway si hay errores de conexión.
  - **Rotar tokens**: regenerar `META_WHATSAPP_TOKEN` u `OPENAI_API_KEY` si hay fallos de auth.
- **Recuperación**:
  - **Drain controlado**: usar BullMQ para reintentar trabajos pendientes.
  - **Reprocesar**: si algún mensaje falló, reenviarlo desde WhatsApp o usar scripts para reinserción.
  - **Post-mortem**: registrar causa raíz y acciones preventivas en `docs/incidents/` (crear carpeta si aún no existe).

### Comandos conversacionales
- **`listar temas`**: devuelve ids y títulos de tópicos activos.
- **`cambiar a: <texto|id>`**: selecciona un tópico existente.
- **`nuevo tema: <título>`**: fuerza la creación de un nuevo tópico y lo activa.
- **`reset` / `reinicia`**: limpia selección activa para comenzar tema nuevo.
- **Adhesión**: Comandos se procesan en `services/orchestrator` antes de encolar el LLM.

### Retención de datos y mantenimiento
- **Historial**: Redis guarda turnos por tópico con `TOPIC_HIST_SIZE` (últimos N elementos). Resumen se almacena separado (`setSummary`).
- **Límites recomendados**:
  - **`TOPIC_HIST_SIZE`** ≥ 12 para conversaciones largas.
  - **`TOPIC_SUM_EVERY`** controla frecuencia de resúmenes automáticos.
- **Depuración**:
  - **Comando sugerido**: script para limpiar tópicos inactivos (`updatedAt` > X días).
  - **Backups**: Upstash ofrece snapshots; revisar plan actual.

### Integraciones externas
- **WhatsApp Business API**: Implementar envío real en `WhatsAppOutbound.sendText()` con proveedor seleccionado (incluye manejo de plantillas y rate limits).
- **OpenAI**: `@unogo/llm-openai` y `@unogo/embeddings-openai` comparten credencial. Considerar fallback local si es necesario.
- **Herramientas opcionales**: Integrar monitoreo (Datadog, Grafana) usando los logs/métricas descritos.

### Anexos y próximos pasos
- **Diagramas**: mantener actualizado el diagrama Mermaid anterior. Opcionalmente generar un “Service Map” en imagen (Vercel design, Railway, Upstash, Meta, OpenAI).
- **Documentos relacionados**:
  - `docs/deploy.md` — guías de despliegue.
  - `docs/technological_architecture.txt` (este documento) — visión técnica.
  - `README.md` — panorama del repositorio.
- **Pendientes**:
  - **Implementar**: integración real del proveedor WhatsApp.
  - **Automatizar**: scripts de limpieza de tópicos y alarmas de cola.
  - **Versionar**: mantener `.env.example` alineado a variables vigentes.

