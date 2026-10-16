import type { MigrationInterface, QueryRunner } from 'typeorm';

// 1. Every company has a wallet. UNIQUE (company_id) only gave "at most one"; a
//    company without a wallet broke the purchase (seller wallet missing) and
//    GET /companies/:id (inner join). Checked at COMMIT, because the company and its
//    wallet are separate statements; a wallet cannot be deleted or moved to another
//    company afterwards. Companies that already lack one get an empty wallet.
// 2. wallet_operations.created_at defaults to clock_timestamp(), like deals and the
//    histories: with now() a purchase that waited for a wallet lock got the time its
//    transaction started, earlier than the deposit it waited for.
export class CompanyWalletJournalTime1760800000000 implements MigrationInterface {
  name = 'CompanyWalletJournalTime1760800000000';

  async up(q: QueryRunner): Promise<void> {
    // 1. Wallet of every company.
    await q.query(`
      INSERT INTO wallets (company_id)
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM wallets w WHERE w.company_id = c.id)`);
    await q.query(`
      CREATE FUNCTION check_company_has_wallet() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM wallets WHERE company_id = NEW.id) THEN
          RAISE EXCEPTION 'company % has no wallet', NEW.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'companies_wallet_required';
        END IF;
        RETURN NULL;
      END
      $fn$`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER companies_wallet_required
        AFTER INSERT ON companies
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_company_has_wallet()`);
    await q.query(`
      CREATE FUNCTION forbid_wallet_detach() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'wallet % belongs to its company for good', OLD.id
          USING ERRCODE = 'check_violation', CONSTRAINT = 'wallets_keep_company';
      END
      $fn$`);
    await q.query(`
      CREATE TRIGGER wallets_keep_company
        BEFORE DELETE OR UPDATE OF company_id ON wallets
        FOR EACH ROW EXECUTE FUNCTION forbid_wallet_detach()`);

    // 2. Moment of a journal row.
    await q.query(
      `ALTER TABLE wallet_operations ALTER COLUMN created_at SET DEFAULT clock_timestamp()`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE wallet_operations ALTER COLUMN created_at SET DEFAULT now()`,
    );
    await q.query(`DROP TRIGGER wallets_keep_company ON wallets`);
    await q.query(`DROP FUNCTION forbid_wallet_detach()`);
    await q.query(`DROP TRIGGER companies_wallet_required ON companies`);
    await q.query(`DROP FUNCTION check_company_has_wallet()`);
  }
}
