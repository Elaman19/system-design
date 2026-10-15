import type { MigrationInterface, QueryRunner } from 'typeorm';

// Rules that used to live only in DealsService / LotsService / WalletsService and
// are now enforced by the database, so a second writer cannot break them:
//  1. wallets.balance is maintained by a trigger on wallet_operations and cannot be
//     changed directly: "balance = sum(journal)" holds by construction.
//  2. A deal is only accepted for a published lot at the lot's current price.
//  3. lot_stock_history is a chain: every row matches the lot's stock and continues
//     the previous row; lots.stock cannot differ from the last row at COMMIT; a deal
//     without its stock row is rejected at COMMIT.
//  4. lot_price_history and lot_publication_history are append-only like the rest.
//  5. lots.price and lots.is_published cannot differ from the last row of their history
//     at COMMIT (same idea as the stock chain), and every lot has both histories.
//  6. deals.created_at defaults to clock_timestamp(), like the history timestamps:
//     "price at the moment of the deal" (valid_from <= created_at) must not depend on
//     when the transaction happened to start.
export class EnforceDealRules1760700000000 implements MigrationInterface {
  name = 'EnforceDealRules1760700000000';

  async up(q: QueryRunner): Promise<void> {
    // 1. Balance.
    await q.query(`
      CREATE FUNCTION apply_wallet_operation() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        UPDATE wallets SET balance = balance + NEW.amount, updated_at = now()
         WHERE id = NEW.wallet_id;
        RETURN NULL;
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER wallet_operations_apply_balance
        AFTER INSERT ON wallet_operations
        FOR EACH ROW EXECUTE FUNCTION apply_wallet_operation()`);
    // pg_trigger_depth() is 1 for a client statement and 2 for the UPDATE issued by
    // apply_wallet_operation(), which is the only writer allowed to touch the balance.
    await q.query(`
      CREATE FUNCTION forbid_direct_balance_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF (TG_OP = 'INSERT' AND NEW.balance <> 0)
           OR (TG_OP = 'UPDATE' AND NEW.balance <> OLD.balance AND pg_trigger_depth() < 2) THEN
          RAISE EXCEPTION 'wallet balance changes only through wallet_operations'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'wallets_balance_journal_only';
        END IF;
        RETURN NEW;
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER wallets_balance_journal_only
        BEFORE INSERT OR UPDATE OF balance ON wallets
        FOR EACH ROW EXECUTE FUNCTION forbid_direct_balance_change()`);

    // 2. Terms of a deal. FOR SHARE keeps the lot row from changing price or being
    // hidden until the deal commits, even for a writer that did not lock the lot.
    await q.query(`
      CREATE FUNCTION check_deal_terms() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        lot_price bigint;
        published boolean;
      BEGIN
        SELECT price, is_published INTO lot_price, published
          FROM lots WHERE id = NEW.lot_id FOR SHARE;
        IF NOT FOUND THEN
          RETURN NEW; -- the foreign key reports a missing lot
        END IF;
        IF NOT published THEN
          RAISE EXCEPTION 'lot % is not published', NEW.lot_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_lot_is_published';
        END IF;
        IF NEW.unit_price <> lot_price THEN
          RAISE EXCEPTION 'deal price % differs from the price % of lot %', NEW.unit_price, lot_price, NEW.lot_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'deals_unit_price_is_lot_price';
        END IF;
        RETURN NEW;
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER deals_terms_check
        BEFORE INSERT ON deals
        FOR EACH ROW EXECUTE FUNCTION check_deal_terms()`);

    // 3. Stock chain.
    await q.query(
      `CREATE INDEX lot_stock_history_lot_id_id_idx ON lot_stock_history (lot_id, id)`,
    );
    await q.query(
      `ALTER TABLE lot_stock_history DROP CONSTRAINT lot_stock_history_reason_known`,
    );
    await q.query(`
      ALTER TABLE lot_stock_history
        ADD CONSTRAINT lot_stock_history_reason_known
        CHECK (reason IN ('initial', 'restock', 'writeoff', 'sale'))`);
    // Named lot_stock_history_state so it fires after lot_stock_history_deal_delta
    // (BEFORE triggers run in name order).
    await q.query(`
      CREATE FUNCTION check_stock_history_state() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        current_stock integer;
        previous integer;
      BEGIN
        SELECT stock INTO current_stock FROM lots WHERE id = NEW.lot_id;
        IF current_stock IS DISTINCT FROM NEW.stock_after THEN
          RAISE EXCEPTION 'stock history of lot % says % but the lot has %', NEW.lot_id, NEW.stock_after, current_stock
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lot_stock_history_matches_lot';
        END IF;
        SELECT stock_after INTO previous
          FROM lot_stock_history WHERE lot_id = NEW.lot_id ORDER BY id DESC LIMIT 1;
        IF NEW.reason = 'initial' THEN
          IF previous IS NOT NULL OR NEW.delta <> NEW.stock_after THEN
            RAISE EXCEPTION 'initial stock of lot % must be the first row and start from zero', NEW.lot_id
              USING ERRCODE = 'check_violation', CONSTRAINT = 'lot_stock_history_chain';
          END IF;
        ELSIF previous IS DISTINCT FROM NEW.stock_after - NEW.delta THEN
          RAISE EXCEPTION 'stock history of lot % does not continue the previous row', NEW.lot_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lot_stock_history_chain';
        END IF;
        RETURN NEW;
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER lot_stock_history_state
        BEFORE INSERT ON lot_stock_history
        FOR EACH ROW EXECUTE FUNCTION check_stock_history_state()`);

    // lots.stock is read back by id, not taken from NEW: when a transaction updates
    // the lot twice, the deferred event of the first update carries a stale row.
    await q.query(`
      CREATE FUNCTION check_lot_stock_matches_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        current_stock integer;
        last_row integer;
      BEGIN
        SELECT stock INTO current_stock FROM lots WHERE id = NEW.id;
        SELECT stock_after INTO last_row
          FROM lot_stock_history WHERE lot_id = NEW.id ORDER BY id DESC LIMIT 1;
        IF last_row IS DISTINCT FROM current_stock THEN
          RAISE EXCEPTION 'lot % has stock % but its history ends at %', NEW.id, current_stock, last_row
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lots_stock_matches_history';
        END IF;
        RETURN NULL;
      END
      $fn$`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER lots_stock_history_check
        AFTER INSERT OR UPDATE OF stock ON lots
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_lot_stock_matches_history()`);

    // A deal moves stock too: its stock-history row must exist at COMMIT.
    await q.query(`
      CREATE OR REPLACE FUNCTION check_deal_ledger() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        deal uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'deals' THEN 'id' ELSE 'deal_id' END)::uuid;
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM deals d
           WHERE d.id = deal
             AND (SELECT count(*) FROM wallet_operations o WHERE o.deal_id = d.id) = 2
             AND EXISTS (SELECT 1 FROM wallet_operations o JOIN wallets w ON w.id = o.wallet_id
                          WHERE o.deal_id = d.id AND o.type = 'purchase'
                            AND w.company_id = d.buyer_id AND o.amount = -d.total)
             AND EXISTS (SELECT 1 FROM wallet_operations o JOIN wallets w ON w.id = o.wallet_id
                          WHERE o.deal_id = d.id AND o.type = 'sale'
                            AND w.company_id = d.seller_id AND o.amount = d.total)
             AND EXISTS (SELECT 1 FROM lot_stock_history h
                          WHERE h.deal_id = d.id AND h.reason = 'sale')
        ) THEN
          RAISE EXCEPTION 'deal % has an inconsistent journal or stock history', deal
            USING ERRCODE = 'check_violation', CONSTRAINT = 'wallet_operations_deal_ledger';
        END IF;
        RETURN NULL;
      END
      $fn$`);

    // 4. The two remaining histories are append-only as well.
    for (const table of ['lot_price_history', 'lot_publication_history']) {
      await q.query(`
        CREATE TRIGGER ${table}_append_only
          BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION forbid_change()`);
      await q.query(`
        CREATE TRIGGER ${table}_no_truncate
          BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()`);
    }

    // 5. Price and publication: the current value on the lot is the last history row.
    // Checked at COMMIT because the lot and its history row are separate statements, in
    // either order. Fires for the lot and for the history tables, so neither side can be
    // written alone. The lot is read back by id (a deferred event carries a stale row).
    await q.query(`
      CREATE FUNCTION check_lot_state_matches_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        lot uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'lots' THEN 'id' ELSE 'lot_id' END)::uuid;
        l lots%ROWTYPE;
        last_price bigint;
        last_published boolean;
      BEGIN
        SELECT * INTO l FROM lots WHERE id = lot;
        SELECT price INTO last_price
          FROM lot_price_history WHERE lot_id = lot ORDER BY id DESC LIMIT 1;
        SELECT is_published INTO last_published
          FROM lot_publication_history WHERE lot_id = lot ORDER BY id DESC LIMIT 1;
        IF last_price IS DISTINCT FROM l.price THEN
          RAISE EXCEPTION 'lot % has price % but its history ends at %', lot, l.price, last_price
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lots_price_matches_history';
        END IF;
        IF last_published IS DISTINCT FROM l.is_published THEN
          RAISE EXCEPTION 'lot % has is_published % but its history ends at %', lot, l.is_published, last_published
            USING ERRCODE = 'check_violation', CONSTRAINT = 'lots_publication_matches_history';
        END IF;
        RETURN NULL;
      END
      $fn$`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER lots_price_publication_history_check
        AFTER INSERT OR UPDATE OF price, is_published ON lots
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_lot_state_matches_history()`);
    for (const table of ['lot_price_history', 'lot_publication_history']) {
      await q.query(`
        CREATE CONSTRAINT TRIGGER ${table}_lot_check
          AFTER INSERT ON ${table}
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION check_lot_state_matches_history()`);
    }

    // 6. Moment of the deal.
    await q.query(
      `ALTER TABLE deals ALTER COLUMN created_at SET DEFAULT clock_timestamp()`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE deals ALTER COLUMN created_at SET DEFAULT now()`,
    );
    for (const table of ['lot_price_history', 'lot_publication_history']) {
      await q.query(`DROP TRIGGER ${table}_lot_check ON ${table}`);
    }
    await q.query(`DROP TRIGGER lots_price_publication_history_check ON lots`);
    await q.query(`DROP FUNCTION check_lot_state_matches_history()`);
    for (const table of ['lot_price_history', 'lot_publication_history']) {
      await q.query(`DROP TRIGGER ${table}_no_truncate ON ${table}`);
      await q.query(`DROP TRIGGER ${table}_append_only ON ${table}`);
    }
    await q.query(`
      CREATE OR REPLACE FUNCTION check_deal_ledger() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        deal uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'deals' THEN 'id' ELSE 'deal_id' END)::uuid;
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM deals d
           WHERE d.id = deal
             AND (SELECT count(*) FROM wallet_operations o WHERE o.deal_id = d.id) = 2
             AND EXISTS (SELECT 1 FROM wallet_operations o JOIN wallets w ON w.id = o.wallet_id
                          WHERE o.deal_id = d.id AND o.type = 'purchase'
                            AND w.company_id = d.buyer_id AND o.amount = -d.total)
             AND EXISTS (SELECT 1 FROM wallet_operations o JOIN wallets w ON w.id = o.wallet_id
                          WHERE o.deal_id = d.id AND o.type = 'sale'
                            AND w.company_id = d.seller_id AND o.amount = d.total)
        ) THEN
          RAISE EXCEPTION 'deal % has an inconsistent journal', deal
            USING ERRCODE = 'check_violation', CONSTRAINT = 'wallet_operations_deal_ledger';
        END IF;
        RETURN NULL;
      END
      $fn$`);
    await q.query(`DROP TRIGGER lots_stock_history_check ON lots`);
    await q.query(`DROP FUNCTION check_lot_stock_matches_history()`);
    await q.query(`DROP TRIGGER lot_stock_history_state ON lot_stock_history`);
    await q.query(`DROP FUNCTION check_stock_history_state()`);
    // NOT VALID: the history is append-only, so rows already written with 'writeoff'
    // stay as they are; the old list applies to new rows only.
    await q.query(`
      ALTER TABLE lot_stock_history DROP CONSTRAINT lot_stock_history_reason_known`);
    await q.query(`
      ALTER TABLE lot_stock_history
        ADD CONSTRAINT lot_stock_history_reason_known
        CHECK (reason IN ('initial', 'restock', 'sale')) NOT VALID`);
    await q.query(`DROP INDEX lot_stock_history_lot_id_id_idx`);
    await q.query(`DROP TRIGGER deals_terms_check ON deals`);
    await q.query(`DROP FUNCTION check_deal_terms()`);
    await q.query(`DROP TRIGGER wallets_balance_journal_only ON wallets`);
    await q.query(`DROP FUNCTION forbid_direct_balance_change()`);
    await q.query(
      `DROP TRIGGER wallet_operations_apply_balance ON wallet_operations`,
    );
    await q.query(`DROP FUNCTION apply_wallet_operation()`);
  }
}
