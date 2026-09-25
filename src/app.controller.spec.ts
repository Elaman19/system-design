import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});

describe('AppController design:paramtypes metadata', () => {
  // emitDecoratorMetadata compiles constructor param types as
  // `typeof X === 'undefined' ? Object : X`, guarding against a param type
  // that isn't defined yet (e.g. a circular import). Both branches are real
  // and reachable, so both need a test: the case above covers the normal
  // "type is defined" path, and this one covers the "not yet defined" path.
  it('falls back to Object when the dependency is not yet defined', async () => {
    vi.resetModules();
    vi.doMock('./app.service.js', () => ({ AppService: undefined }));

    const { AppController: ReloadedAppController } =
      await import('./app.controller.js');

    expect(
      Reflect.getMetadata('design:paramtypes', ReloadedAppController),
    ).toEqual([Object]);

    vi.doUnmock('./app.service.js');
    vi.resetModules();
  });
});
