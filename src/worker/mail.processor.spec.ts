import { UnrecoverableError, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { BanAlertJob } from '../bans/ban-alert.job.js';
import type { ReceiptJob } from '../receipts/receipt.job.js';
import type { DailyReportJob } from '../reports/daily-report.job.js';
import { MailProcessor } from './mail.processor.js';

describe('MailProcessor', () => {
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const processor = new MailProcessor(
    { run: vi.fn() } as unknown as ReceiptJob,
    { run: vi.fn() } as unknown as BanAlertJob,
    { run: vi.fn() } as unknown as DailyReportJob,
    logger as unknown as PinoLogger,
  );
  beforeEach(() => vi.clearAllMocks());

  const job = (attemptsMade: number, attempts?: number) =>
    ({
      id: '1',
      name: 'deal-receipt',
      attemptsMade,
      opts: { attempts },
    }) as unknown as Job;

  it('a failure with attempts left is a warning', () => {
    processor.onFailed(job(1, 5), new Error('x'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'job failed, will be retried',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('the last failed attempt is an error: the job stays in "failed"', () => {
    processor.onFailed(job(5, 5), new Error('x'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'job failed for good',
    );
  });

  it('an unrecoverable failure is final at once, with attempts left', () => {
    processor.onFailed(job(1, 5), new UnrecoverableError('deal not found'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'job failed for good',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a job without a retry setting runs once, so its failure is final', () => {
    processor.onFailed(job(1), new Error('x'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'job failed for good',
    );
  });

  it('a failure with no job attached (stalled and removed) is final', () => {
    processor.onFailed(undefined, new Error('x'));

    expect(logger.warn).toHaveBeenCalled();
  });

  it('connection errors of the worker are logged', () => {
    processor.onError(new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'worker connection error',
    );
  });
});
