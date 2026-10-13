import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ amount: z.number().int() }));

  it('returns the parsed value', () => {
    expect(pipe.transform({ amount: 5 })).toEqual({ amount: 5 });
  });

  it('names the failing field in a 400', () => {
    expect(() => pipe.transform({ amount: 'x' })).toThrow(/amount: /);
  });

  it('says "body" when the whole body has the wrong shape', () => {
    expect(() => pipe.transform('not an object')).toThrow(/body: /);
  });
});
