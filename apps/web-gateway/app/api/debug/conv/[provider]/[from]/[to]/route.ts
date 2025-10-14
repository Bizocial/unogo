import { listTopics, getActive, getContext } from '@unogo/topics';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { provider: string; from: string; to: string } }) {
  const { provider, from, to } = params;
  const convId = [provider, from, to].join(':');

  const topics = await listTopics(convId);
  const active = await getActive(convId);

  let history_len = 0;
  let summary_snippet = '';
  if (active) {
    const ctx = await getContext(convId, active);
    history_len = ctx.history?.length || 0;
    summary_snippet = (ctx.summary || '').slice(0, 140);
  }

  return Response.json({ convId, topics, active, history_len, summary_snippet });
}
