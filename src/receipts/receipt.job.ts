import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { Histogram, Registry } from 'prom-client';
import { DataSource } from 'typeorm';
import { rows } from '../db/sql.js';
import { Mailer } from '../mail/mailer.js';
import { receiptMail } from '../mail/templates.js';

interface DealRow {
  id: string;
  title: string;
  quantity: number;
  unit_price: string;
  total: string;
  created_at: Date;
  buyer_email: string;
}

/**
 * Sends the receipt of a deal exactly once, whatever number of times the job arrives.
 *
 * The idempotency key is the deal id, the lock is the deal's row: "lock the deal, check the
 * marker, send the mail, insert the marker, commit". A second run of the same job (a
 * re-delivered job, a relay that re-added it) finds the marker and returns. Two runs at
 * once: the second waits on the row lock until the first transaction ends, then either sees
 * the marker (first committed: nothing to do) or not (first rolled back because the mail
 * failed: it sends). `FOR NO KEY UPDATE` does not conflict with the key-share locks that
 * foreign keys to `deals` take, so nothing but another receipt run waits on it.
 *
 * The marker goes in after the mail, so `deal_receipts.sent_at` (`clock_timestamp()` at the
 * insert) is the moment the SMTP server accepted the mail: the receipt SLI measures the
 * whole path. Accepted is not delivered: the buyer's mailbox is beyond what we can see.
 * The primary key of `deal_receipts` stays as the last guard against a second marker.
 *
 * The one gap left is a crash between the SMTP server accepting the mail and our COMMIT:
 * the retry then sends a second copy. Closing it needs the mail provider to deduplicate on
 * the Message-ID, which is set to `receipt-<deal>`.
 */
@Injectable()
export class ReceiptJob {
  /** Deal committed → mail accepted by SMTP, seconds: the receipt SLI as it happens. */
  readonly delivery: Histogram;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailer: Mailer,
    registry: Registry,
  ) {
    this.delivery = new Histogram({
      name: 'receipt_delivery_seconds',
      help: 'Time from a deal to its receipt accepted by the SMTP server',
      // 300 s is the SLI boundary, 600 s the page.
      buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [registry],
    });
  }

  async run(dealId: string): Promise<'sent' | 'duplicate'> {
    const seconds = await this.dataSource.transaction(async (em) => {
      const [deal] = await rows<DealRow>(
        em,
        `SELECT d.id, l.title, d.quantity, d.unit_price,
                (d.quantity::bigint * d.unit_price)::text AS total,
                d.created_at, c.email AS buyer_email
           FROM deals d
           JOIN lots l ON l.id = d.lot_id
           JOIN companies c ON c.id = d.buyer_id
          WHERE d.id = $1
            FOR NO KEY UPDATE OF d`,
        [dealId],
      );
      if (!deal) {
        // Retrying cannot create the deal: park the job in "failed" at once.
        throw new UnrecoverableError(`deal ${dealId} not found`);
      }
      const done = await rows(
        em,
        `SELECT 1 FROM deal_receipts WHERE deal_id = $1`,
        [dealId],
      );
      if (done.length > 0) return undefined;

      await this.mailer.send({
        to: deal.buyer_email,
        ...receiptMail({
          dealId: deal.id,
          title: deal.title,
          quantity: deal.quantity,
          unitPrice: deal.unit_price,
          total: deal.total,
          createdAt: deal.created_at,
        }),
      });
      // Both timestamps from the database clock, at full precision.
      const [marked] = await rows<{ seconds: number }>(
        em,
        `INSERT INTO deal_receipts (deal_id, recipient) VALUES ($1, $2)
         RETURNING extract(epoch FROM sent_at - (
           SELECT created_at FROM deals WHERE id = deal_id))::float8 AS seconds`,
        [dealId, deal.buyer_email],
      );
      return marked.seconds;
    });
    if (seconds === undefined) return 'duplicate';
    this.delivery.observe(seconds);
    return 'sent';
  }
}
