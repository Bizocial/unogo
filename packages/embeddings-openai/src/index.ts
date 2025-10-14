import OpenAI from 'openai';

const MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

export type Embedding = number[] | null;

function l2(v: number[]): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  const norm = Math.sqrt(n) || 1;
  return v.map((x) => x / norm);
}

export async function embed(text: string): Promise<Embedding> {
  try {
    const input = (text || '').slice(0, 4000);
    const r = await client.embeddings.create({ model: MODEL, input });
    const v = (r.data?.[0]?.embedding as unknown as number[]) || [];
    if (!Array.isArray(v) || v.length === 0) return null;
    const useL2 = (process.env.EMBED_NORM_L2 || '1') !== '0';
    return useL2 ? l2(v) : v;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]) {
  if (!a.length || !b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
