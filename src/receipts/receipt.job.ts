import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
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
 * The idempotency key is the deal id and the lock is the primary key of `deal_receipts`:
 * "insert the marker first, send the mail second, commit". A second run of the same job
 * (a re-delivered job, a relay that re-added it) inserts nothing and returns. Two runs at
 * once: the second INSERT waits on the unique index until the first transaction ends, then
 * either sees the row (first committed: nothing to do) or gets the slot (first rolled back
 * because the mail failed: it sends). The one gap left is a crash between the SMTP server
 * accepting the mail and our COMMIT: the retry then sends a second copy. Closing it needs
 * the mail provider to deduplicate on the Message-ID, which is set to `receipt-<deal>`.
 */
@Injectable()
export class ReceiptJob {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mailer: Mailer,
  ) {}

  run(dealId: string): Promise<'sent' | 'duplicate'> {
    return this.dataSource.transaction(async (em) => {
      const [deal] = await rows<DealRow>(
        em,
        `SELECT d.id, l.title, d.quantity, d.unit_price,
                (d.quantity::bigint * d.unit_price)::text AS total,
                d.created_at, c.email AS buyer_email
           FROM deals d
           JOIN lots l ON l.id = d.lot_id
           JOIN companies c ON c.id = d.buyer_id
          WHERE d.id = $1`,
        [dealId],
      );
      if (!deal) {
        // Retrying cannot create the deal: park the job in "failed" at once.
        throw new UnrecoverableError(`deal ${dealId} not found`);
      }
      const marked = await rows(
        em,
        `INSERT INTO deal_receipts (deal_id, recipient) VALUES ($1, $2)
         ON CONFLICT (deal_id) DO NOTHING RETURNING deal_id`,
        [dealId, deal.buyer_email],
      );
      if (marked.length === 0) return 'duplicate';

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
      return 'sent';
    });
  }
}
