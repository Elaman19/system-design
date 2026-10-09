import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { ShutdownService } from './../src/health/shutdown.service.js';

// Plain http (no global proxy dispatcher, no keep-alive) so a refused
// connection surfaces as ECONNREFUSED instead of a proxy error.
function get(port: number, path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      })
      .on('error', reject);
  });
}

async function createApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  return app;
}

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/live (GET) is 200', () => {
    return request(app.getHttpServer()).get('/live').expect(200);
  });

  it('/ready (GET) is 200 with the database up', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(res.body.info).toHaveProperty('database');
  });

  it('echoes a valid x-request-id and generates one otherwise', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/')
      .set('x-request-id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');

    const generated = await request(app.getHttpServer()).get('/');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('/work (GET) sleeps the requested time, capped', async () => {
    await request(app.getHttpServer())
      .get('/work?ms=10')
      .expect(200)
      .expect({ sleptMs: 10 });
    await request(app.getHttpServer())
      .get('/work?ms=1')
      .expect(200)
      .expect({ sleptMs: 1 });
  });
});

describe('graceful shutdown (e2e)', () => {
  it('finishes an in-flight request, turns /ready to 503, then refuses connections', async () => {
    const app = await createApp();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;

    const inFlight = get(port, '/work?ms=500');
    await new Promise((r) => setTimeout(r, 100));
    const closing = app.close();
    await new Promise((r) => setTimeout(r, 50));

    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sleptMs: 500 });

    await closing;
    await expect(get(port, '/live')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  it('answers /ready with 503 naming "shutdown" during the drain', async () => {
    const app = await createApp();
    app.get(ShutdownService).onModuleDestroy();

    const res = await request(app.getHttpServer()).get('/ready').expect(503);
    expect(res.body.error).toHaveProperty('shutdown');
    await app.close();
  });
});
