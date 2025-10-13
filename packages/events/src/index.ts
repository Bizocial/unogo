import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

export const queues = {
  'channel.message.received': new Queue('channel.message.received', { connection }),
  'llm.reply.requested': new Queue('llm.reply.requested', { connection }),
  'llm.reply.ready': new Queue('llm.reply.ready', { connection }),
  'notification.send.requested': new Queue('notification.send.requested', { connection })
};

export const add = (q: keyof typeof queues, data: any, opts?: any) =>
  queues[q].add(q as string, data, {
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: 'exponential', delay: 500 },
    ...opts
  });

export const worker = (
  q: keyof typeof queues,
  handler: (d: any) => Promise<void>
) =>
  new Worker(
    q as string,
    async (job: any) => handler(job.data),
    { connection, concurrency: 5 }
  );

export const events = (q: keyof typeof queues) => new QueueEvents(q as string, { connection });
