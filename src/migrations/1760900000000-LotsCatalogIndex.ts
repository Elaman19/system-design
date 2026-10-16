import type { MigrationInterface, QueryRunner } from 'typeorm';

// GET /lots shows published lots newest first and pages by (created_at, id). A partial
// index in exactly that order lets each page be an index range scan that stops after
// `limit` rows, instead of sorting every published lot on every request. Text search
// (ILIKE '%...%') cannot use a btree; that is ADR 0005's signal for OpenSearch.
export class LotsCatalogIndex1760900000000 implements MigrationInterface {
  name = 'LotsCatalogIndex1760900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE INDEX lots_catalog_idx
        ON lots (created_at DESC, id DESC) WHERE is_published`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX lots_catalog_idx`);
  }
}
