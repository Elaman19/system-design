import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Producer } from '@platformatic/kafka';
import { PinoLogger } from 'nestjs-pino';
import { ENV, type Env } from '../config/env.js';
import { createProducer } from '../kafka/clients.js';
import type { ViewEvent } from './view-event.js';

/**
 * Hands lot-card views to Kafka without ever making the request wait for it.
 *
 * `record` only appends to a bounded in-memory buffer; a timer sends the buffer in one
 * batch every CLICKSTREAM_LINGER_MS. When Kafka is unreachable the batch is dropped and
 * counted, when the buffer is full new views are dropped: views are analytics, not
 * money, so losing some is the price of the card opening whatever happens to Kafka.
 * The key is the visitor's IP, see docs/background/README.md for why not the lot id.
 */
@Injectable()
export class ViewEventsPublisher implements OnApplicationShutdown {
  private readonly buffer: ViewEvent[] = [];
  private producer?: Producer<string, string, string, string>;
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private dropped = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ViewEventsPublisher.name);
  }

  /** Views thrown away since start: Kafka down or buffer full. */
  get droppedCount() {
    return this.dropped;
  }

  record(event: ViewEvent) {
    if (this.buffer.length >= this.env.CLICKSTREAM_BUFFER_MAX) {
      this.dropped++;
      return;
    }
    this.buffer.push(event);
    this.schedule();
  }

  async flush() {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    try {
      this.producer ??= createProducer(this.env);
      await this.producer.send({
        // acks=1: the partition leader has it. A lost view after a leader crash is
        // acceptable here and saves a round trip to the followers.
        acks: 1,
        messages: batch.map((event) => ({
          topic: this.env.KAFKA_TOPIC_LOT_VIEWS,
          key: event.ip,
          value: JSON.stringify(event),
        })),
      });
    } catch (error) {
      this.dropped += batch.length;
      this.logger.warn(
        { err: error, lost: batch.length, droppedTotal: this.dropped },
        'Kafka unavailable, views dropped',
      );
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) this.schedule();
    }
  }

  private schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.env.CLICKSTREAM_LINGER_MS).unref();
  }

  async onApplicationShutdown() {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
    await this.producer?.close();
  }
}
