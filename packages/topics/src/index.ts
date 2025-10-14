import IORedis from 'ioredis';
import { embed, cosine } from '@unogo/embeddings-openai';

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

const HSIZE = Number(process.env.TOPIC_HIST_SIZE || 8);
const SUM_EVERY = Number(process.env.TOPIC_SUM_EVERY || 10);
const SIM_NEW = Number(process.env.TOPIC_SIM_NEW || 0.78);
const SIM_STICKY = Number(process.env.TOPIC_SIM_STICKY || 0.7);

function kTopicsKey(convId: string) { return `conv:${convId}:topics`; }
function kTopicMeta(convId: string, tid: string) { return `conv:${convId}:topic:${tid}`; }
function kHist(convId: string, tid: string) { return `conv:${convId}:hist:${tid}`; }
function kSum(convId: string, tid: string) { return `conv:${convId}:sum:${tid}`; }
function kActive(convId: string) { return `conv:${convId}:active`; }

async function now() { return Date.now(); }

export async function listTopics(convId: string) {
  const ids: string[] = await redis.zrevrange(kTopicsKey(convId), 0, -1);
  const metas = await Promise.all(
    ids.map(async (id: string) => {
      const h = await redis.hgetall(kTopicMeta(convId, id));
      return {
        id,
        title: h.title || `Tema ${id.slice(0, 6)}`,
        updatedAt: Number(h.updatedAt || 0),
        count: Number(h.count || 0)
      } as { id: string; title: string; updatedAt: number; count: number };
    })
  );
  return metas;
}

export async function getActive(convId: string) {
  return (await redis.get(kActive(convId))) || '';
}

export async function setActive(convId: string, topicId: string) {
  await redis.set(kActive(convId), topicId || '');
}

export async function appendTurn(
  convId: string,
  topicId: string,
  turn: { role: 'user' | 'assistant'; content: string; ts: number }
) {
  const hkey = kHist(convId, topicId);
  await redis.rpush(hkey, JSON.stringify(turn));
  // trim to last HSIZE*2 to keep some buffer before getContext slices last N
  await redis.ltrim(hkey, -HSIZE * 2, -1);
  await redis.hincrby(kTopicMeta(convId, topicId), 'count', 1);
  await redis.hset(kTopicMeta(convId, topicId), 'updatedAt', String(await now()));
  await redis.zadd(kTopicsKey(convId), Date.now(), topicId);
}

export async function getContext(convId: string, topicId: string) {
  const items: string[] = await redis.lrange(kHist(convId, topicId), -HSIZE, -1);
  const history = items
    .map((s: string) => {
      try {
        return JSON.parse(s) as { role: 'user' | 'assistant'; content: string; ts: number };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
  const summary = await redis.get(kSum(convId, topicId)) || '';
  return { history, summary } as {
    history: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
    summary: string;
  };
}

export async function setSummary(convId: string, topicId: string, text: string) {
  await redis.set(kSum(convId, topicId), text || '');
}

function avg(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  const out = new Array(n);
  for (let i=0;i<n;i++) out[i] = (a[i] + b[i]) / 2;
  return out as number[];
}

async function upsertTopic(convId: string, title: string, vec: number[]) {
  const id = (await redis.incr(`seq:topics`)).toString();
  await redis.hset(kTopicMeta(convId, id), 'title', title, 'centroid', JSON.stringify(vec), 'updatedAt', String(await now()), 'count', '0');
  await redis.zadd(kTopicsKey(convId), Date.now(), id);
  return id;
}

async function topicSimilarity(convId: string, vec: number[]) {
  const ids: string[] = await redis.zrevrange(kTopicsKey(convId), 0, -1);
  let bestId = '';
  let best = -1;
  for (const id of ids) {
    const meta = await redis.hget(kTopicMeta(convId, id), 'centroid');
    if (!meta) continue;
    try {
      const c = JSON.parse(meta as string) as number[];
      const s = cosine(vec, c);
      if (s > best) { best = s; bestId = id; }
    } catch {}
  }
  return { bestId, best };
}

export async function detectOrCreateTopic(convId: string, userText: string) {
  const vec = await embed(userText);

  // If embedding failed, avoid fragmenting topics.
  if (!vec || vec.length === 0) {
    const active = await getActive(convId);
    if (active) return { topicId: active, created: false as const };
    const existing: string[] = await redis.zrevrange(kTopicsKey(convId), 0, 0);
    if (existing.length > 0) {
      await setActive(convId, existing[0]);
      return { topicId: existing[0], created: false as const };
    }
    const title0 = (userText || '').slice(0, 40).trim() || 'Nuevo tema';
    const id0 = await upsertTopic(convId, title0, []);
    await setActive(convId, id0);
    return { topicId: id0, created: true as const };
  }

  const { bestId, best } = await topicSimilarity(convId, vec);

  // sticky threshold: if active topic is close enough, keep it
  const active = await getActive(convId);
  if (active) {
    const acMeta = await redis.hget(kTopicMeta(convId, active), 'centroid');
    if (acMeta) {
      try {
        const ac = JSON.parse(acMeta) as number[];
        const s = cosine(vec, ac);
        if (s >= SIM_STICKY) return { topicId: active, created: false as const };
      } catch {}
    }
  }

  // new topic if no similar above SIM_NEW
  if (!bestId || best < SIM_NEW) {
    const title = (userText || '').slice(0, 40).trim() || 'Nuevo tema';
    const id = await upsertTopic(convId, title, vec);
    await setActive(convId, id);
    return { topicId: id, created: true as const };
  }

  // otherwise attach to the most similar and update centroid
  const meta = await redis.hget(kTopicMeta(convId, bestId), 'centroid');
  if (meta) {
    try {
      const c = JSON.parse(meta) as number[];
      const next = avg(c, vec);
      await redis.hset(kTopicMeta(convId, bestId), 'centroid', JSON.stringify(next));
    } catch {}
  }
  await setActive(convId, bestId);
  return { topicId: bestId, created: false as const };
}
