import type { DailyReport } from '../reports/daily-report.js';

const money = (cents: string | number) =>
  (BigInt(cents) / 100n).toString() +
  '.' +
  (BigInt(cents) % 100n).toString().padStart(2, '0');

export interface ReceiptData {
  dealId: string;
  title: string;
  quantity: number;
  unitPrice: string;
  total: string;
  createdAt: Date;
}

export const receiptMail = (d: ReceiptData) => ({
  subject: `Чек по сделке ${d.dealId}`,
  text: [
    `Сделка ${d.dealId} от ${d.createdAt.toISOString()}.`,
    `Лот: ${d.title}`,
    `Количество: ${d.quantity}`,
    `Цена за штуку: ${money(d.unitPrice)}`,
    `Итого списано: ${money(d.total)}`,
  ].join('\n'),
  messageId: `<receipt-${d.dealId}@marketplace.local>`,
});

export interface BanData {
  id: string;
  ip: string;
  bannedFrom: Date;
  bannedUntil: Date;
  views: number;
}

export const banAlertMail = (b: BanData) => ({
  subject: `IP ${b.ip} забанен`,
  text: [
    `IP ${b.ip} забанен: ${b.views} просмотров лотов за окно детектора.`,
    `Бан с ${b.bannedFrom.toISOString()} до ${b.bannedUntil.toISOString()}.`,
  ].join('\n'),
  messageId: `<ip-ban-${b.id}@marketplace.local>`,
});

export const reportMail = (r: DailyReport) => ({
  subject: `Отчёт площадки за сутки до ${r.periodEnd.toISOString()}`,
  text: [
    `Опубликовано лотов сейчас: ${r.publishedNow}`,
    `Опубликовано за сутки: ${r.publishedLastDay}`,
    `Сделок за сутки: ${r.dealsLastDay}`,
    `Сумма сделок за сутки: ${money(r.dealsAmountLastDay)}`,
  ].join('\n'),
  messageId: `<daily-report-${r.periodEnd.getTime()}@marketplace.local>`,
});
