import { randomUUID } from 'node:crypto';
import { stringSerializers } from '@platformatic/kafka';
import { loadEnv } from '../../src/config/env.js';
import {
  createAdmin,
  createConsumer,
  createProducer,
} from '../../src/kafka/clients.js';
import { ensureTopics } from '../../src/kafka/topics.js';

export interface Received {
  key: string;
  value: string;
  partition: number;
  offset: bigint;
}

/** A topic of its own (3 partitions like the real ones), so test files never read each other's messages. */
export async function newTopic(label: string): Promise<string> {
  const env = loadEnv();
  const topic = `test-${label}-${randomUUID()}`;
  const admin = createAdmin(env);
  try {
    await ensureTopics(admin, env, [topic]);
  } finally {
    await admin.close();
  }
  return topic;
}

export async function produce(
  topic: string,
  messages: { key: string; value: string }[],
) {
  const producer = createProducer(loadEnv());
  try {
    await producer.send({
      acks: -1,
      messages: messages.map((m) => ({ topic, key: m.key, value: m.value })),
    });
  } finally {
    await producer.close();
  }
}

/** Reads `count` messages of the topic from the beginning, in a throwaway group. */
export async function readMessages(
  topic: string,
  count: number,
  timeoutMs = 20_000,
) {
  const consumer = createConsumer(loadEnv(), `test-reader-${randomUUID()}`);
  const stream = await consumer.consume({
    topics: [topic],
    mode: 'earliest',
    autocommit: false,
  });
  const got: Received[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.destroy();
  }, timeoutMs);
  try {
    for await (const m of stream) {
      got.push({
        key: m.key,
        value: m.value,
        partition: m.partition,
        offset: m.offset,
      });
      if (got.length >= count) break;
    }
  } catch (error) {
    // Running out of time is a normal end ("there were fewer messages"), not a failure.
    if (!timedOut) throw error;
  } finally {
    clearTimeout(timer);
    await consumer.close(true);
  }
  return got;
}

/** Committed offset of a group on a topic, per partition. */
export async function committed(groupId: string, topic: string) {
  const consumer = createConsumer(loadEnv(), groupId);
  try {
    const offsets = await consumer.listCommittedOffsets({
      topics: [{ topic, partitions: [0, 1, 2] }],
    });
    return offsets.get(topic) ?? [];
  } finally {
    await consumer.close(true);
  }
}

export { stringSerializers };
