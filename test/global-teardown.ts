import { Admin } from '@platformatic/kafka';

/**
 * Tests create a topic of their own each (`test-...`) so files never read each other's
 * messages. Once the whole run is over they are deleted, with their consumer-group
 * offsets, so the broker does not fill up with them over many runs.
 */
export default function setup() {
  return async () => {
    const admin = new Admin({
      clientId: 'test-teardown',
      bootstrapBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9094').split(
        ',',
      ),
    });
    try {
      const topics = (await admin.listTopics()).filter((t) =>
        t.startsWith('test-'),
      );
      if (topics.length > 0) await admin.deleteTopics({ topics });
    } finally {
      await admin.close();
    }
  };
}
