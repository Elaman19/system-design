import {
  Admin,
  Consumer,
  Producer,
  stringDeserializers,
  stringSerializers,
} from '@platformatic/kafka';
import type { Env } from '../config/env.js';

const base = (env: Env) => ({
  clientId: env.KAFKA_CLIENT_ID,
  bootstrapBrokers: env.KAFKA_BROKERS.split(','),
});

// Keys and values are text (JSON); the key is what picks the partition.
export const createProducer = (env: Env) =>
  new Producer({
    ...base(env),
    serializers: stringSerializers,
    // Fail fast: a producer that retries for minutes would hold the click stream's
    // buffer full while Kafka is away. Callers decide what a failed send means.
    retries: 1,
    timeout: 3000,
  });

/** The real group id of a consumer group: the configured prefix plus the group's own name. */
export const groupName = (env: Env, name: string) =>
  env.KAFKA_GROUP_PREFIX + name;

/** Manual commit is the caller's job: `consume({ autocommit: false })`. */
export const createConsumer = (env: Env, name: string) =>
  new Consumer({
    ...base(env),
    groupId: groupName(env, name),
    deserializers: stringDeserializers,
  });

export const createAdmin = (env: Env) => new Admin(base(env));
