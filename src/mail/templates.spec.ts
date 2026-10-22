import { banAlertMail, receiptMail, reportMail } from './templates.js';

describe('mail templates', () => {
  it('writes money as units and cents, padding the cents', () => {
    const mail = receiptMail({
      dealId: 'd1',
      title: 'Станок',
      quantity: 1,
      unitPrice: '100005',
      total: '100005',
      createdAt: new Date('2026-10-20T10:00:00Z'),
    });

    expect(mail.text).toContain('Цена за штуку: 1000.05');
    expect(mail.text).toContain('Итого списано: 1000.05');
    expect(mail.messageId).toBe('<receipt-d1@marketplace.local>');
  });

  it('a ban alert names the IP, the number of views and the period', () => {
    const mail = banAlertMail({
      id: '7',
      ip: '203.0.113.7',
      views: 301,
      bannedFrom: new Date('2026-10-20T10:00:00Z'),
      bannedUntil: new Date('2026-10-20T11:00:00Z'),
    });

    expect(mail.subject).toBe('IP 203.0.113.7 забанен');
    expect(mail.text).toContain('301 просмотров');
    expect(mail.text).toContain('2026-10-20T11:00:00.000Z');
    expect(mail.messageId).toBe('<ip-ban-7@marketplace.local>');
  });

  it('a report carries the four numbers', () => {
    const mail = reportMail({
      periodEnd: new Date('2026-10-20T09:00:00Z'),
      publishedNow: 12,
      publishedLastDay: 3,
      dealsLastDay: 2,
      dealsAmountLastDay: '250050',
    });

    expect(mail.text).toBe(
      [
        'Опубликовано лотов сейчас: 12',
        'Опубликовано за сутки: 3',
        'Сделок за сутки: 2',
        'Сумма сделок за сутки: 2500.50',
      ].join('\n'),
    );
  });
});
