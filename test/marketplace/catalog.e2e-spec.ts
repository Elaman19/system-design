import { randomUUID } from 'node:crypto';
import { createHarness, type Harness, seedCompany } from './helpers.js';

// Other test files write lots into the same database at the same time, so every test
// here names its lots with a fresh token and searches by it.
describe('lot catalog (GET /lots)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const token = () => `t${randomUUID().slice(0, 8)}`;

  async function lot(
    sellerId: string,
    title: string,
    { published = true, deliveryMethods = [] as string[] } = {},
  ) {
    const created = await h
      .http()
      .post('/lots')
      .send({ sellerId, title, price: 150_000, stock: 2, deliveryMethods })
      .expect(201);
    if (published) {
      await h
        .http()
        .patch(`/lots/${created.body.id}/publication`)
        .send({ published: true })
        .expect(200);
    }
    return created.body.id as string;
  }

  it('lists published lots newest first, with the seller and delivery methods; hidden lots are not shown', async () => {
    const seller = await seedCompany(h);
    const t = token();
    const older = await lot(seller, `Пресс ${t}`, {
      deliveryMethods: ['pickup', 'freight'],
    });
    await lot(seller, `Скрытый ${t}`, { published: false });
    const newer = await lot(seller, `Станок ${t}`);

    const res = await h.http().get('/lots').query({ q: t }).expect(200);
    expect(res.body.nextAfter).toBeNull();
    expect(res.body.items).toEqual([
      {
        id: newer,
        sellerId: seller,
        sellerName: 'ООО Тест',
        title: `Станок ${t}`,
        price: 150_000,
        stock: 2,
        published: true,
        deliveryMethods: [],
      },
      expect.objectContaining({
        id: older,
        deliveryMethods: ['freight', 'pickup'],
      }),
    ]);
  });

  it('pages by a cursor: no lot is skipped or repeated, the last page has no cursor', async () => {
    const seller = await seedCompany(h);
    const t = token();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await lot(seller, `Лот ${i} ${t}`));

    const first = await h
      .http()
      .get('/lots')
      .query({ q: t, limit: 2 })
      .expect(200);
    expect(first.body.items.map((l: { id: string }) => l.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(first.body.nextAfter).toBe(ids[1]);

    // A lot added between the two requests lands on top and does not shift page two.
    await lot(seller, `Новый ${t}`);
    const second = await h
      .http()
      .get('/lots')
      .query({ q: t, limit: 2, after: first.body.nextAfter.toUpperCase() })
      .expect(200);
    expect(second.body.items.map((l: { id: string }) => l.id)).toEqual([
      ids[0],
    ]);
    expect(second.body.nextAfter).toBeNull();
  });

  it("finds lots by the seller's name or email, ignoring case", async () => {
    const t = token();
    const email = `${t}@Example.com`;
    const created = await h
      .http()
      .post('/companies')
      .send({ name: `Завод ${t}`, email })
      .expect(201);
    const id = await lot(created.body.id, 'Фрезерный станок');

    for (const q of [`завод ${t}`, email.toLowerCase()]) {
      const res = await h.http().get('/lots').query({ q }).expect(200);
      expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([id]);
    }
  });

  it('treats % and _ in the search text literally', async () => {
    const seller = await seedCompany(h);
    const t = token();
    const literal = await lot(seller, `Скидка 100%_\\ ${t}`);
    await lot(seller, `Скидка 1000 ${t}`);

    const res = await h
      .http()
      .get('/lots')
      .query({ q: `100%_\\ ${t}` })
      .expect(200);
    expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([literal]);
  });

  it('works without a search text', async () => {
    const res = await h.http().get('/lots').query({ limit: 1 }).expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body).toHaveProperty('nextAfter');
  });

  it('rejects a bad page size or cursor with 400', async () => {
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { limit: 'abc' },
      { q: '   ' },
      { after: 'not-a-uuid' },
    ]) {
      const res = await h.http().get('/lots').query(query).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const unknown = await h
      .http()
      .get('/lots')
      .query({ after: randomUUID() })
      .expect(400);
    expect(unknown.body.message).toContain('after');
  });
});
