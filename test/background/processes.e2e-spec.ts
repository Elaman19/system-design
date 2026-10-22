import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AbuseDetectorModule } from '../../src/abuse/abuse-detector.module.js';
import { ArchiverModule } from '../../src/clickstream/archiver.module.js';
import { CoreModule } from '../../src/core.module.js';
import { SchedulerModule } from '../../src/scheduler/scheduler.module.js';

describe('processes that never touch Postgres', () => {
  it.each<[string, Type]>([
    ['abuse-detector', AbuseDetectorModule],
    ['clickstream-archiver', ArchiverModule],
    ['scheduler', SchedulerModule],
  ])(
    '%s is built from CoreModule alone: no database pool, no DataSource',
    async (_name, module) => {
      const app = await Test.createTestingModule({
        imports: [CoreModule, module],
      }).compile();

      expect(() => app.get(DataSource, { strict: false })).toThrow();

      await app.close();
    },
  );
});
