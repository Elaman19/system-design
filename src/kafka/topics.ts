import type { Admin } from '@platformatic/kafka';
import type { Env } from '../config/env.js';

export const TOPIC_PARTITIONS = 3;
/** Single broker in Compose; production keeps 3 (and `min.insync.replicas=2`). */
export const TOPIC_REPLICAS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Kafka deletes a segment once everything in it is older than this. Long enough for a
 * stopped consumer to come back after a weekend and catch up; the sizing is in
 * docs/background/README.md.
 */
export const RETENTION_MS = 7 * DAY_MS;
/**
 * Safety cap, per partition: when a burst outgrows the time limit the broker deletes the
 * oldest segments instead of filling its disk and stopping for everyone. 8 GiB is about
 * twice what the design load (docs/background/README.md) writes into a partition in a
 * week, so in normal life the time limit is the one that applies.
 */
export const RETENTION_BYTES = 8 * 1024 ** 3;

export const topicNames = (env: Env) => [
  env.KAFKA_TOPIC_LOT_VIEWS,
  env.KAFKA_TOPIC_IP_BANS,
];

/** Creates the topics that do not exist yet; running it again is harmless. */
export async function ensureTopics(
  admin: Admin,
  env: Env,
  names = topicNames(env),
) {
  const existing = new Set(await admin.listTopics());
  const missing = names.filter((name) => !existing.has(name));
  if (missing.length === 0) return missing;
  await admin.createTopics({
    topics: missing,
    partitions: TOPIC_PARTITIONS,
    replicas: TOPIC_REPLICAS,
    configs: [
      { name: 'retention.ms', value: String(RETENTION_MS) },
      { name: 'retention.bytes', value: String(RETENTION_BYTES) },
    ],
  });
  return missing;
}
