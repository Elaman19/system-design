/** Name of the one queue every background mail goes through. */
export const MAIL_QUEUE = 'mail';

export const JobName = {
  dealReceipt: 'deal-receipt',
  ipBanAlert: 'ip-ban-alert',
  dailyReport: 'daily-report',
} as const;

export interface DealReceiptData {
  dealId: string;
}
export interface IpBanAlertData {
  banId: string;
}
export interface DailyReportData {
  /** End of the reported day, ISO 8601. */
  periodEnd: string;
}

/**
 * Deterministic job ids: adding the same id twice is a no-op while the first job is still
 * stored (BullMQ keeps completed jobs for a day, see QueueModule). It is the first layer
 * of defence against duplicates; the handlers are idempotent on their own as well.
 */
export const dealReceiptJobId = (dealId: string) => `deal-receipt-${dealId}`;
export const ipBanAlertJobId = (banId: string) => `ip-ban-${banId}`;
