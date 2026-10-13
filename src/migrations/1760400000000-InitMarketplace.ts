import type { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-written SQL: every constraint is named explicitly because the API maps
// constraint names to client-facing messages (see src/db/constraint-messages.ts).
export class InitMarketplace1760400000000 implements MigrationInterface {
  name = 'InitMarketplace1760400000000';

  async up(q: QueryRunner): Promise<void> {
    // gen_random_uuid() is built in since PG13; no extension needed.
    await q.query(`
      CREATE TABLE companies (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name       text        NOT NULL,
        email      text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT companies_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT companies_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$')
      )`);
    // Rule 1: e-mail is unique ignoring case -> expression index.
    await q.query(
      `CREATE UNIQUE INDEX companies_email_lower_key ON companies (lower(email))`,
    );

    await q.query(`
      CREATE TABLE wallets (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid        NOT NULL REFERENCES companies (id),
        -- Cents. Materialised sum of wallet_operations.amount; the journal is the source of truth.
        balance    bigint      NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        -- Rule 2: one wallet per company -> plain unique constraint.
        CONSTRAINT wallets_company_id_key UNIQUE (company_id),
        CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0)
      )`);

    await q.query(`
      CREATE TABLE lots (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        seller_id    uuid        NOT NULL REFERENCES companies (id),
        title        text        NOT NULL,
        -- Cents. Current state; history lives in lot_*_history.
        price        bigint      NOT NULL,
        stock        integer     NOT NULL,
        is_published boolean     NOT NULL DEFAULT false,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        -- Target of the composite FK from deals: a deal cannot name a seller who does not own the lot.
        CONSTRAINT lots_id_seller_id_key UNIQUE (id, seller_id),
        CONSTRAINT lots_title_not_blank CHECK (btrim(title) <> ''),
        CONSTRAINT lots_price_positive CHECK (price > 0),
        CONSTRAINT lots_stock_non_negative CHECK (stock >= 0)
      )`);
    await q.query(`CREATE INDEX lots_seller_id_idx ON lots (seller_id)`);

    await q.query(`
      CREATE TABLE lot_photos (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        lot_id       uuid        NOT NULL REFERENCES lots (id) ON DELETE CASCADE,
        s3_key       text        NOT NULL,
        content_type text        NOT NULL,
        size_bytes   bigint      NOT NULL,
        position     smallint    NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT lot_photos_s3_key_key UNIQUE (s3_key),
        CONSTRAINT lot_photos_lot_id_position_key UNIQUE (lot_id, position),
        CONSTRAINT lot_photos_content_type_known CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
        CONSTRAINT lot_photos_size_positive CHECK (size_bytes > 0),
        CONSTRAINT lot_photos_position_non_negative CHECK (position >= 0)
      )`);

    // 4NF: delivery methods are independent of photos, so they get their own table
    // instead of one (lot, photo, method) table that would hold photos x methods rows.
    await q.query(`
      CREATE TABLE lot_delivery_methods (
        lot_id uuid NOT NULL REFERENCES lots (id) ON DELETE CASCADE,
        method text NOT NULL,
        PRIMARY KEY (lot_id, method),
        CONSTRAINT lot_delivery_methods_method_known CHECK (method IN ('pickup', 'courier', 'freight'))
      )`);

    await q.query(`
      CREATE TABLE deals (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        lot_id     uuid        NOT NULL,
        -- Deliberate 3NF departure: seller_id is determined by lot_id. Kept so a deal is
        -- self-contained; the composite FK below stops it from ever disagreeing with lots.
        seller_id  uuid        NOT NULL,
        buyer_id   uuid        NOT NULL REFERENCES companies (id),
        quantity   integer     NOT NULL,
        -- Cents, the price at the moment of the deal (lots.price changes later).
        unit_price bigint      NOT NULL,
        total      bigint      GENERATED ALWAYS AS (quantity::bigint * unit_price) STORED,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT deals_lot_seller_fkey FOREIGN KEY (lot_id, seller_id) REFERENCES lots (id, seller_id),
        CONSTRAINT deals_buyer_is_not_seller CHECK (buyer_id <> seller_id),
        CONSTRAINT deals_quantity_positive CHECK (quantity > 0),
        CONSTRAINT deals_unit_price_positive CHECK (unit_price > 0)
      )`);
    await q.query(`CREATE INDEX deals_lot_id_idx ON deals (lot_id)`);
    await q.query(`CREATE INDEX deals_buyer_id_idx ON deals (buyer_id)`);
    await q.query(`CREATE INDEX deals_seller_id_idx ON deals (seller_id)`);

    await q.query(`
      CREATE TABLE wallet_operations (
        id                   bigserial   PRIMARY KEY,
        wallet_id            uuid        NOT NULL REFERENCES wallets (id),
        type                 text        NOT NULL,
        -- Signed cents: positive credits the wallet, negative debits it.
        amount               bigint      NOT NULL,
        deal_id              uuid        REFERENCES deals (id),
        bank_notification_id text,
        created_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallet_operations_type_known CHECK (type IN ('deposit', 'purchase', 'sale')),
        CONSTRAINT wallet_operations_shape CHECK (
          (type = 'deposit'  AND amount > 0 AND bank_notification_id IS NOT NULL AND deal_id IS NULL) OR
          (type = 'purchase' AND amount < 0 AND bank_notification_id IS NULL     AND deal_id IS NOT NULL) OR
          (type = 'sale'     AND amount > 0 AND bank_notification_id IS NULL     AND deal_id IS NOT NULL)
        )
      )`);
    // Rule 3: one bank notification -> one deposit. Partial, because only deposits
    // carry a notification id; global, so the same notification cannot credit two wallets.
    await q.query(`
      CREATE UNIQUE INDEX wallet_operations_bank_notification_key
        ON wallet_operations (bank_notification_id)
        WHERE bank_notification_id IS NOT NULL`);
    // A deal moves money once per wallet side (purchase on the buyer, sale on the seller).
    await q.query(`
      CREATE UNIQUE INDEX wallet_operations_deal_wallet_key
        ON wallet_operations (deal_id, wallet_id)
        WHERE deal_id IS NOT NULL`);
    await q.query(
      `CREATE INDEX wallet_operations_wallet_id_idx ON wallet_operations (wallet_id, id)`,
    );

    await q.query(`
      CREATE TABLE lot_price_history (
        id         bigserial   PRIMARY KEY,
        lot_id     uuid        NOT NULL REFERENCES lots (id),
        price      bigint      NOT NULL,
        valid_from timestamptz NOT NULL,
        CONSTRAINT lot_price_history_price_positive CHECK (price > 0),
        -- Rule 4: one price record per lot and moment -> composite unique.
        CONSTRAINT lot_price_history_lot_id_valid_from_key UNIQUE (lot_id, valid_from)
      )`);

    await q.query(`
      CREATE TABLE lot_publication_history (
        id           bigserial   PRIMARY KEY,
        lot_id       uuid        NOT NULL REFERENCES lots (id),
        is_published boolean     NOT NULL,
        changed_at   timestamptz NOT NULL,
        CONSTRAINT lot_publication_history_lot_id_changed_at_key UNIQUE (lot_id, changed_at)
      )`);

    await q.query(`
      CREATE TABLE lot_stock_history (
        id          bigserial   PRIMARY KEY,
        lot_id      uuid        NOT NULL REFERENCES lots (id),
        delta       integer     NOT NULL,
        stock_after integer     NOT NULL,
        reason      text        NOT NULL,
        deal_id     uuid        REFERENCES deals (id),
        changed_at  timestamptz NOT NULL,
        CONSTRAINT lot_stock_history_stock_after_non_negative CHECK (stock_after >= 0),
        CONSTRAINT lot_stock_history_reason_known CHECK (reason IN ('initial', 'restock', 'sale')),
        CONSTRAINT lot_stock_history_sale_has_deal CHECK ((reason = 'sale') = (deal_id IS NOT NULL))
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'lot_stock_history',
      'lot_publication_history',
      'lot_price_history',
      'wallet_operations',
      'deals',
      'lot_delivery_methods',
      'lot_photos',
      'lots',
      'wallets',
      'companies',
    ]) {
      await q.query(`DROP TABLE ${table}`);
    }
  }
}
