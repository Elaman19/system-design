import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller.js';
import { ENV } from './config/env.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  const query = vi.fn().mockResolvedValue([]);

  async function build(workEnabled: boolean) {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: { query } },
        { provide: ENV, useValue: { WORK_ENDPOINT_ENABLED: workEnabled } },
      ],
    }).compile();
    return app.get<AppController>(AppController);
  }

  beforeEach(async () => {
    query.mockClear();
    appController = await build(true);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('work', () => {
    it('sleeps for the requested time', async () => {
      expect(await appController.work('250')).toEqual({ sleptMs: 250 });
      expect(query).toHaveBeenCalledWith('SELECT pg_sleep($1)', [0.25]);
    });

    it('defaults to 500ms when ms is missing or invalid', async () => {
      expect(await appController.work()).toEqual({ sleptMs: 500 });
      expect(await appController.work('-3')).toEqual({ sleptMs: 500 });
      expect(await appController.work('abc')).toEqual({ sleptMs: 500 });
    });

    it('is 404 when WORK_ENDPOINT_ENABLED is off', async () => {
      const disabled = await build(false);
      await expect(disabled.work('10')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('caps the duration at 5s', async () => {
      expect(await appController.work('999999')).toEqual({ sleptMs: 5000 });
    });
  });
});
