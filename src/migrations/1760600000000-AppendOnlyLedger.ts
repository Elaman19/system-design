import type { MigrationInterface, QueryRunner } from 'typeorm';

// 1. deals, wallet_operations and lot_stock_history are append-only. The deferred ledger
//    trigger only fires on INSERT, so without this a committed deal could be repriced or a
//    journal row edited or deleted and nothing would notice. Corrections are new rows.
// 2. A 'sale' row of lot_stock_history must describe its deal: same lot (composite FK),
//    delta = -deal.quantity (trigger), and at most one such row per deal (partial unique).
export class AppendOnlyLedger1760600000000 implements MigrationInterface {
  name = 'AppendOnlyLedger1760600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
          USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_append_only';
      END
      $fn$`);
    for (const table of ['deals', 'wallet_operations', 'lot_stock_history']) {
      await q.query(`
        CREATE TRIGGER ${table}_append_only
          BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION forbid_change()`);
      await q.query(`
        CREATE TRIGGER ${table}_no_truncate
          BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()`);
    }

    await q.query(
      `ALTER TABLE deals ADD CONSTRAINT deals_id_lot_id_key UNIQUE (id, lot_id)`,
    );
    await q.query(
      `ALTER TABLE lot_stock_history DROP CONSTRAINT lot_stock_history_deal_id_fkey`,
    );
    // MATCH SIMPLE: rows without a deal (initial, restock) are not checked.
    await q.query(`
      ALTER TABLE lot_stock_history
        ADD CONSTRAINT lot_stock_history_deal_lot_fkey
        FOREIGN KEY (deal_id, lot_id) REFERENCES deals (id, lot_id)`);
    await q.query(`
      CREATE UNIQUE INDEX lot_stock_history_deal_key
        ON lot_stock_history (deal_id) WHERE deal_id IS NOT NULL`);
    await q.query(`
      CREATE FUNCTION check_stock_history_delta() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = NEW.deal_id AND d.quantity = -NEW.delta) THEN
          RAISE EXCEPTION 'stock delta % does not match deal %', NEW.delta, NEW.deal_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lot_stock_history_deal_delta';
        END IF;
        RETURN NEW;
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER lot_stock_history_deal_delta
        BEFORE INSERT ON lot_stock_history
        FOR EACH ROW WHEN (NEW.deal_id IS NOT NULL)
        EXECUTE FUNCTION check_stock_history_delta()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER lot_stock_history_deal_delta ON lot_stock_history`,
    );
    await q.query(`DROP FUNCTION check_stock_history_delta()`);
    await q.query(`DROP INDEX lot_stock_history_deal_key`);
    await q.query(
      `ALTER TABLE lot_stock_history DROP CONSTRAINT lot_stock_history_deal_lot_fkey`,
    );
    await q.query(`
      ALTER TABLE lot_stock_history
        ADD CONSTRAINT lot_stock_history_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES deals (id)`);
    await q.query(`ALTER TABLE deals DROP CONSTRAINT deals_id_lot_id_key`);
    for (const table of ['deals', 'wallet_operations', 'lot_stock_history']) {
      await q.query(`DROP TRIGGER ${table}_no_truncate ON ${table}`);
      await q.query(`DROP TRIGGER ${table}_append_only ON ${table}`);
    }
    await q.query(`DROP FUNCTION forbid_change()`);
  }
}
