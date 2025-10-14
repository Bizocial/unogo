Superprompt Colaborativo — “Topic-Aware Memory + Arquitectura Agnóstica” (UnoGO)

Tú (Windsurf Cascade) actúas como Ingeniero de Software y Reviewer.
Yo (Arquitecto) defino objetivos, lineamientos, contratos y ejemplos.
Debes aplicar cambios de forma segura, proponiendo mejoras cuando detectes riesgos, simplificaciones o mejores prácticas.
Si discrepas con alguna decisión, expón tu propuesta y razón, y aplica la alternativa superior.

CONTEXTO ACTUAL (DADO)
Monorepo con workspaces: apps/*, services/*, packages/*.
Agnosticidad de canal (WhatsApp hoy, Telegram mañana) y LLM (OpenAI hoy; Gemini/Claude luego).
Flujo event-driven con Redis/BullMQ:
channel.message.received → llm.reply.requested → llm.reply.ready → notification.send.requested.
Webhook WA con verificación HMAC (Meta).

OBJETIVOS (NUEVO ALCANCE)
Memoria por temas (Topic-Aware) con hilos; enrutamiento por similitud (embeddings) + histeresis (umbral pegajoso).
Contexto compacto por tema: últimos N turnos + resumen incremental.
Comandos suaves:
listar temas → lista títulos/IDs,
cambiar a: <tema|id> → activa hilo,
nuevo tema: … → fuerza creación,
reset/reinicia → memoria limpia.
Mantener agnosticidad de canal/LLM; no acoplar dominio a proveedores.
Colaboración: puedes refactorizar, consolidar paquetes, o cambiar libs (p. ej., mejorar adapter OpenAI a messages[] nativo) si demuestras ventaja (robustez, perf, claridad).

RESTRICCIONES Y LINEAMIENTOS
TS + ESM + Node 18+, estricto.
No romper nombres de colas/eventos existentes.
Mantener idempotencia futura (lista como TODO si no se implementa ahora).
Evitar código “muerto”; si propones alternativa superior, elimina el obsoleto de forma segura.
Seguridad: jamás loggear secretos; sanitiza PII (teléfonos) si añades logs.

ENTREGABLES
Paquetes nuevos:
@unogo/embeddings-openai (wrapper embeddings + cosine),
@unogo/topics (topic manager con Redis).
Cambios en servicios:
services/orchestrator: enrutamiento por tema + comandos,
services/llm-bridge: contexto por tema, respuesta y resumen.
Variables en infra/.env.example para umbrales.
Tests básicos (scripts o instrucciones reproducibles) para validar flujo.
Commits pequeños con mensajes claros.
Documento corto docs/topics.md (uso y parámetros).

PLAN (PASO A PASO) — PUEDES AJUSTAR CON JUSTIFICACIÓN
Embeddings wrapper
Crear packages/embeddings-openai:
// src/index.ts
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

export async function embed(text: string): Promise<number[]> {
  const input = text.slice(0, 4000);
  const r = await client.embeddings.create({ model: MODEL, input });
  return r.data[0].embedding as unknown as number[];
}

export function cosine(a: number[], b: number[]) {
  let dot=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
}

Si consideras mejor otro modelo o normalización (p. ej. L2), propón y aplica.
Topic manager
Crear packages/topics (usa Redis existente):
API mínima:
detectOrCreateTopic(convId, userText) → { topicId, created } con SIM_NEW/SIM_STICKY,
appendTurn(convId, topicId, turn), getContext(convId, topicId),
listTopics(convId), getActive/ setActive,
setSummary(convId, topicId, text).
Estructuras Redis:
conv:{id}:topics (zset por updatedAt),
conv:{id}:topic:{tid} (hash meta: title, centroid, updatedAt, count),
conv:{id}:hist:{tid} (list), conv:{id}:sum:{tid} (str), conv:{id}:active (str).
Si prefieres pgvector (ya planificado), déjalo opcional con interfaz; no bloquees la entrega.
Orchestrator
Incorporar comandos: listar temas, cambiar a:, nuevo tema:, reset/reinicia.
Flujo:
Construye convId = provider:from:to,
Si comando → responde vía notification.send.requested y return,
detectOrCreateTopic → appendTurn(user),
getContext y publicar llm.reply.requested con { convId, topicId, context }.
Si ves oportunidad de outbox o ratelimits simples, anótalo como TODO con stub.
LLM Bridge
Construir mensajes con:
system (prompt), summary por tema (si existe), history (últimos turnos).
Llamar al LLM (adapter OpenAI actual).
appendTurn(assistant) + llm.reply.ready.
Cada TOPIC_SUM_EVERY turnos → generar resumen (5 líneas) y guardar con setSummary.
Si eliges pasar messages[] nativo en @unogo/llm-openai, haz el refactor y ajusta tests.
ENV y Docs
En infra/.env.example agrega:
EMBED_MODEL=text-embedding-3-small
TOPIC_HIST_SIZE=8
TOPIC_SUM_EVERY=10
TOPIC_SIM_NEW=0.78
TOPIC_SIM_STICKY=0.70

docs/topics.md: comandos y explicación de umbrales.
Tests rápidos
Script o instrucciones:
Enviar 3 mensajes sobre Tema A, luego “nuevo tema: …” (Tema B), luego “cambiar a: A”.
Ver que el hilo activo cambia y el contexto es el correcto.
Ajustar TOPIC_SIM_NEW alto → forzar nuevos temas; bajo → colapsar en uno; documentar.

CÓDIGO SUGERIDO (EDITABLE POR TI)
Orchestrator (reemplazo controlado del handler)
// services/orchestrator/src/index.ts
import { worker, add } from '@unogo/events';
import { logger } from '@unogo/shared';
import {
  detectOrCreateTopic, appendTurn, getContext,
  setActive, getActive, listTopics
} from '@unogo/topics';

const CMD_LIST = /^listar temas\b/i;
const CMD_SWITCH = /^cambiar a:\s*(.+)$/i;
const CMD_NEW = /^nuevo tema:\s*(.+)$/i;
const CMD_RESET = /^(reset|reinicia)\b/i;

function convIdOf(msg:any){ return [msg.provider, msg.from, msg.to].join(':'); }

worker('channel.message.received', async ({ message }) => {
  const convId = convIdOf(message);
  const text = (message.text || '').trim();

  // Comandos
  if (CMD_LIST.test(text)) {
    const topics = await listTopics(convId);
    const lines = topics.map(t=>`• ${t.id.slice(0,6)} — ${t.title}`);
    await add('notification.send.requested', { to: message.from, text: lines.length? `Temas:\n${lines.join('\n')}` : 'No hay temas aún.' });
    return;
  }
  const sw = text.match(CMD_SWITCH);
  if (sw) {
    const topics = await listTopics(convId);
    const target = topics.find(t=> t.title.toLowerCase().includes(sw[1].toLowerCase()) || t.id.startsWith(sw[1]));
    if (target){ await setActive(convId, target.id);
      await add('notification.send.requested', { to: message.from, text: `Ok, cambié al tema: ${target.title}` });
    } else {
      await add('notification.send.requested', { to: message.from, text: 'No encontré ese tema.' });
    }
    return;
  }
  const nw = text.match(CMD_NEW);
  if (nw) {
    // Forzamos un nuevo tema con ese título, delega a detectOrCreate para centroid
    const { topicId } = await detectOrCreateTopic(convId, nw[1]);
    await setActive(convId, topicId);
    await add('notification.send.requested', { to: message.from, text: `Nuevo tema creado: ${nw[1]}` });
    return;
  }
  if (CMD_RESET.test(text)) {
    await setActive(convId, "");
    await add('notification.send.requested', { to: message.from, text: 'Listo, empecemos un tema nuevo. Cuéntame.' });
    return;
  }

  // Topic routing automático
  const { topicId, created } = await detectOrCreateTopic(convId, text);
  logger.info({ convId, topicId, created }, 'Topic selected');
  await appendTurn(convId, topicId, { role: 'user', content: text, ts: Date.now() });

  const ctx = await getContext(convId, topicId);
  await add('llm.reply.requested', { message, convId, topicId, context: ctx });
});

LLM Bridge (usa summary + history del topic)
// services/llm-bridge/src/index.ts
import { worker, add } from '@unogo/events';
import { SYSTEM_PROMPT_ES_v1 } from '@unogo/prompts';
import { OpenAIChat } from '@unogo/llm-openai';
import { appendTurn, setSummary } from '@unogo/topics';

function fold(system: string, summary: string, history: any[]) {
  const parts = [`SYSTEM: ${system}`];
  if (summary) parts.push(`SYSTEM: Resumen del tema → ${summary}`);
  for (const t of history) parts.push(`${t.role.toUpperCase()}: ${t.content}`);
  return { system, user: parts.slice(1).join('\n\n') };
}

async function summarize(convId:string, topicId:string, history:any[]) {
  const stride = Number(process.env.TOPIC_SUM_EVERY || 10);
  if (!stride || history.length % stride !== 0) return;
  const res = await OpenAIChat.chat({
    system: 'Eres un asistente que resume hilos en máx 5 líneas útiles.',
    user: history.map((t:any)=>`${t.role}: ${t.content}`).join('\n')
  });
  if (res.text) await setSummary(convId, topicId, res.text);
}

worker('llm.reply.requested', async ({ message, convId, topicId, context }) => {
  const { history = [], summary = "" } = context || {};
  const { system, user } = fold(SYSTEM_PROMPT_ES_v1, summary, history);

  const res = await OpenAIChat.chat({ system, user });
  const reply = res.text || '…';

  await appendTurn(convId, topicId, { role: 'assistant', content: reply, ts: Date.now() });
  await add('llm.reply.ready', { to: message.from, text: reply });

  await summarize(convId, topicId, history);
});

Si decides migrar @unogo/llm-openai a messages[] nativo, hazlo y adapta el fold para devolver messages en vez de system/user concatenados.

VALIDACIÓN (CHECKLIST)
pnpm i en raíz, Redis up, pnpm dev levanta web + workers.
Conversación “Tema A” conserva contexto; “nuevo tema: …” crea B; “cambiar a: A” retoma A con su contexto.
listar temas muestra títulos/IDs.
Umbrales TOPIC_SIM_NEW y TOPIC_SIM_STICKY se respetan (probar extremos).
No se rompió nada de colas ni webhook.
Logs sin PII sensibles, sin secretos.

COMMITS (SUGERIDOS, AJÚSTALOS SI CAMBIAS EL PLAN)
feat: embeddings wrapper for topic routing (@unogo/embeddings-openai)
feat: topic manager with Redis (topics, histories, summaries)
feat(orchestrator): topic routing + commands (listar, cambiar, nuevo tema, reset)
feat(llm-bridge): per-topic context + periodic summaries
chore(env): add topic memory defaults (thresholds and sizes)
docs: topics.md usage and thresholds

ESPACIO PARA MEJORAS (TU CRITERIO)
Si detectas mejor estructura (p. ej. unificar conversations+topics), propón y aplica.
Si consideras que pgvector aporta más claridad que Redis para centroides, deja driver dual (Redis por defecto; Postgres opcional) y documenta.
Si ves oportunidad de DLQ dedicada o rate limiting en webhook, anótalo en TODO con stubs o impleméntalo si es trivial.

FIN DEL SUPERPROMPT.
Procede, valida y propón mejoras si encuentras alternativas superiores.
