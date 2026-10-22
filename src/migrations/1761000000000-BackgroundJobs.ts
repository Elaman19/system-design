import type { MigrationInterface, QueryRunner } from 'typeorm';

// Background work (homework 05). Three tables, every rule that can live in the database does:
//
// outbox         written in the SAME transaction as the thing it announces (a deal), read by
//                the relay, which puts a job into Redis and marks the row. One row per
//                (kind, aggregate): a deal gets one receipt however often the code retries.
// deal_receipts  "receipt for this deal was sent": the idempotency key of the receipt job.
//                The primary key is the lock: of two workers handling the same deal only one
//                inserts, the other waits for its commit and then sees the conflict.
// ip_bans        bans from the abuse detector. A ban event may arrive twice (at-least-once);
//                the exclusion constraint forbids two overlapping bans of one IP, so the
//                second insert is a no-op instead of a duplicate row and a duplicate mail.
export class BackgroundJobs1761000000000 implements MigrationInterface {
  name = 'BackgroundJobs1761000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE outbox (
        id           bigserial   PRIMARY KEY,
        kind         text        NOT NULL,
        aggregate_id uuid        NOT NULL,
        -- clock_timestamp(), not now(): rows of one long transaction keep their real order.
        created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
        -- NULL until the relay has handed the row to the queue.
        published_at timestamptz,
        CONSTRAINT outbox_kind_known CHECK (kind IN ('deal.receipt')),
        CONSTRAINT outbox_kind_aggregate_id_key UNIQUE (kind, aggregate_id)
      )`);
    // The relay only ever looks at unpublished rows; the index shrinks to nothing when it keeps up.
    await q.query(
      `CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL`,
    );

    await q.query(`
      CREATE TABLE deal_receipts (
        deal_id   uuid        PRIMARY KEY REFERENCES deals (id),
        recipient text        NOT NULL,
        sent_at   timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
    await q.query(`
      CREATE TRIGGER deal_receipts_append_only
        BEFORE UPDATE OR DELETE ON deal_receipts
        FOR EACH ROW EXECUTE FUNCTION forbid_change()`);
    await q.query(`
      CREATE TRIGGER deal_receipts_no_truncate
        BEFORE TRUNCATE ON deal_receipts
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()`);

    await q.query(`
      CREATE TABLE ip_bans (
        id           bigserial   PRIMARY KEY,
        ip           inet        NOT NULL,
        banned_from  timestamptz NOT NULL,
        banned_until timestamptz NOT NULL,
        -- Views counted in the window that triggered the ban; for the admin's mail.
        views        integer     NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT ip_bans_period_valid CHECK (banned_until > banned_from),
        CONSTRAINT ip_bans_views_positive CHECK (views > 0),
        -- No two overlapping bans of one IP. gist inet_ops supports = and the range overlap
        -- is on the period; the API's "is this IP banned now" check uses the same index.
        CONSTRAINT ip_bans_no_overlap EXCLUDE USING gist (
          ip inet_ops WITH =,
          tstzrange(banned_from, banned_until) WITH &&
        )
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE ip_bans`);
    await q.query(`DROP TABLE deal_receipts`);
    await q.query(`DROP TABLE outbox`);
  }
}
