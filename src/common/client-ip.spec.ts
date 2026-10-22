import { clientIp, validClientIp } from './client-ip.js';

describe('clientIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    [undefined, ''],
  ])('%s -> %s', (input, expected) => {
    expect(clientIp(input)).toBe(expected);
  });
});

describe('validClientIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['not-an-ip', undefined],
    ['1.2.3.4, 5.6.7.8', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%s -> %s', (input, expected) => {
    expect(validClientIp(input)).toBe(expected);
  });
});
