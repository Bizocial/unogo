# Topics: Memoria por temas y ruteo por similitud

- **Paquetes**
  - **@unogo/embeddings-openai**: `embed(text)` y `cosine(a,b)` para similitud.
  - **@unogo/topics**: gestor de temas (Redis) con API:
    - `detectOrCreateTopic(convId, userText)` → `{ topicId, created }`
    - `appendTurn(convId, topicId, turn)`
    - `getContext(convId, topicId)` → `{ history, summary }`
    - `listTopics(convId)` → `[{ id, title, updatedAt, count }]`
    - `getActive(convId)` / `setActive(convId, topicId)`
    - `setSummary(convId, topicId, text)`

- **Estructuras Redis**
  - `conv:{id}:topics` zset (por `updatedAt`)
  - `conv:{id}:topic:{tid}` hash (meta: `title`, `centroid`, `updatedAt`, `count`)
  - `conv:{id}:hist:{tid}` list (turnos)
  - `conv:{id}:sum:{tid}` str (resumen)
  - `conv:{id}:active` str

- **Servicios**
  - `services/orchestrator`:
    - Comandos: `listar temas`, `cambiar a: <tema|id>`, `nuevo tema: <título>`, `reset|reinicia`.
    - Flujo: construye `convId = provider:from:to`, enruta a tema (detectOrCreate), agrega turno user y publica `llm.reply.requested` con `{ message, convId, topicId, context }`.
  - `services/llm-bridge`:
    - Con `context.summary` y `context.history`, arma prompt y llama LLM.
    - Agrega turno assistant, publica `llm.reply.ready`.
    - Cada `TOPIC_SUM_EVERY` turnos, resume el tema y guarda con `setSummary`.

- **Variables de entorno** (`infra/.env.example`)
  - `EMBED_MODEL=text-embedding-3-small`
  - `TOPIC_HIST_SIZE=8`
  - `TOPIC_SUM_EVERY=10`
  - `TOPIC_SIM_NEW=0.78`
  - `TOPIC_SIM_STICKY=0.70`

- **Validación rápida**
  1. Asegúrate de tener Redis y `OPENAI_API_KEY` configurados.
  2. Envía 3 mensajes sobre un mismo tema (A) → debe mantenerse en un solo `topicId`.
  3. Envía `nuevo tema: Viajes` → crea tema B y lo activa.
  4. Envía `cambiar a: A` → activa A nuevamente.
  5. Envía `listar temas` → muestra títulos/IDs.
  6. Ajusta umbrales:
     - `TOPIC_SIM_NEW` alto → fuerza temas nuevos con facilidad.
     - `TOPIC_SIM_NEW` bajo → colapsa en uno.

- **Notas**
  - No se cambian nombres de colas/eventos.
  - Idempotencia y rate limits: TODOs a implementar (outbox/ratelimit simple en webhook si es necesario).
  - No se registran secretos; sanitiza PII en logs si los agregas.
