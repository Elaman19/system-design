import { randomUUID } from 'node:crypto';
import { ConfigResourceTypes } from '@platformatic/kafka';
import { loadEnv } from '../../src/config/env.js';
import { createAdmin } from '../../src/kafka/clients.js';
import {
  RETENTION_BYTES,
  RETENTION_MS,
  TOPIC_PARTITIONS,
  ensureTopics,
  topicNames,
} from '../../src/kafka/topics.js';

describe('Kafka topics', () => {
  it('are created with three partitions and the chosen retention; creating again changes nothing', async () => {
    const env = loadEnv();
    const names = [
      `test-topics-${randomUUID()}`,
      `test-topics-${randomUUID()}`,
    ];
    const admin = createAdmin(env);
    try {
      expect(await ensureTopics(admin, env, names)).toEqual(names);
      expect(await ensureTopics(admin, env, names)).toEqual([]);

      const meta = await admin.metadata({ topics: names });
      expect(names.map((n) => meta.topics.get(n)?.partitionsCount)).toEqual([
        TOPIC_PARTITIONS,
        TOPIC_PARTITIONS,
      ]);
      const [config] = await admin.describeConfigs({
        resources: [
          {
            resourceType: ConfigResourceTypes.TOPIC,
            resourceName: names[0],
            configurationKeys: ['retention.ms', 'retention.bytes'],
          },
        ],
      });
      expect(config.configs.find((c) => c.name === 'retention.ms')?.value).toBe(
        String(RETENTION_MS),
      );
      expect(
        config.configs.find((c) => c.name === 'retention.bytes')?.value,
      ).toBe(String(RETENTION_BYTES));
    } finally {
      await admin.deleteTopics({ topics: names });
      await admin.close();
    }
  });

  it('the project topics are lot-views and ip-bans by default', () => {
    expect(topicNames(loadEnv())).toEqual(['lot-views', 'ip-bans']);
  });

  it('retention is seven days, capped at 8 GiB per partition', () => {
    expect(RETENTION_MS).toBe(604_800_000);
    expect(RETENTION_BYTES).toBe(8_589_934_592);
  });

  it('default names come from the environment, not the code', () => {
    expect(
      topicNames({
        ...loadEnv(),
        KAFKA_TOPIC_LOT_VIEWS: 'a',
        KAFKA_TOPIC_IP_BANS: 'b',
      }),
    ).toEqual(['a', 'b']);
  });
});
