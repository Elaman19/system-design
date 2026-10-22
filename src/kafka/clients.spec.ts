import { loadEnv } from '../config/env.js';
import { createConsumer, groupName } from './clients.js';

describe('consumer group names', () => {
  it('are the prefix plus the group name', () => {
    expect(
      groupName({ ...loadEnv(), KAFKA_GROUP_PREFIX: 'ci-' }, 'abuse-detector'),
    ).toBe('ci-abuse-detector');
  });

  it('are not prefixed unless configured', () => {
    expect(
      groupName({ ...loadEnv(), KAFKA_GROUP_PREFIX: '' }, 'abuse-detector'),
    ).toBe('abuse-detector');
  });

  it('are what a consumer joins', async () => {
    const consumer = createConsumer(
      { ...loadEnv(), KAFKA_GROUP_PREFIX: 'ci-' },
      'clickstream-archiver',
    );

    expect(consumer.groupId).toBe('ci-clickstream-archiver');
    await consumer.close();
  });
});
