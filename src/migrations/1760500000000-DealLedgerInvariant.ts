import type { MigrationInterface, QueryRunner } from 'typeorm';

// A deal moves money exactly once: the buyer's wallet is debited by deals.total and the
// seller's is credited by the same amount, nothing else. Row-level CHECKs cannot see
// other rows, so this is a constraint trigger, deferred to COMMIT because the deal and
// its two journal rows are inserted by separate statements of one transaction.
export class DealLedgerInvariant1760500000000 implements MigrationInterface {
  name = 'DealLedgerInvariant1760500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE FUNCTION check_deal_ledger() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        -- NEW has different columns per table, so read the key through jsonb.
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
    await q.query(`
      CREATE CONSTRAINT TRIGGER deals_ledger_check
        AFTER INSERT ON deals
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_deal_ledger()`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER wallet_operations_ledger_check
        AFTER INSERT ON wallet_operations
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW WHEN (NEW.deal_id IS NOT NULL)
        EXECUTE FUNCTION check_deal_ledger()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER wallet_operations_ledger_check ON wallet_operations`,
    );
    await q.query(`DROP TRIGGER deals_ledger_check ON deals`);
    await q.query(`DROP FUNCTION check_deal_ledger()`);
  }
}
