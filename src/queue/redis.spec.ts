import { redisConnection } from './redis.js';

describe('redisConnection', () => {
  it('reads host and port, defaults the rest', () => {
    expect(redisConnection('redis://redis:6380')).toEqual({
      host: 'redis',
      port: 6380,
      username: undefined,
      password: undefined,
      db: undefined,
      tls: undefined,
    });
  });

  it('defaults the port', () => {
    expect(redisConnection('redis://redis')).toMatchObject({ port: 6379 });
  });

  it('reads credentials and database, and TLS from rediss', () => {
    expect(
      redisConnection('rediss://user:secret@cache.example:6380/3'),
    ).toEqual({
      host: 'cache.example',
      port: 6380,
      username: 'user',
      password: 'secret',
      db: 3,
      tls: {},
    });
  });
});
