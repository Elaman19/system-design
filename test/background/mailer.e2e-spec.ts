import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Test } from '@nestjs/testing';
import { ENV, loadEnv } from '../../src/config/env.js';
import { SmtpMailer } from '../../src/mail/mailer.js';
import { eventually } from './helpers.js';

const MAILPIT = 'http://localhost:8025';

describe('SmtpMailer', () => {
  it('delivers through SMTP; Mailpit catches it', async () => {
    const module = await Test.createTestingModule({
      providers: [SmtpMailer, { provide: ENV, useValue: loadEnv() }],
    }).compile();
    const mailer = module.get(SmtpMailer);
    const to = `${randomUUID()}@catch.example`;

    await mailer.send({
      to,
      subject: 'Тема письма',
      text: 'Текст',
      messageId: `<${randomUUID()}@marketplace.local>`,
    });

    const found = await eventually(async () => {
      const res = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      );
      const body = (await res.json()) as {
        messages: { Subject: string; From: { Address: string } }[];
      };
      return body.messages[0];
    }, 'Mailpit to receive the mail');
    expect(found.Subject).toBe('Тема письма');
    expect(found.From.Address).toBe('noreply@marketplace.local');
    await module.close();
  });

  it('gives up on a server that accepts the connection and then says nothing', async () => {
    // The transaction around the send is idle meanwhile, so the wait has to be short.
    const sockets: net.Socket[] = [];
    const silent = net.createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) =>
      silent.listen(0, '127.0.0.1', resolve),
    );
    const { port } = silent.address() as net.AddressInfo;
    const module = await Test.createTestingModule({
      providers: [
        SmtpMailer,
        {
          provide: ENV,
          useValue: {
            ...loadEnv(),
            MAIL_SMTP_URL: `smtp://127.0.0.1:${port}`,
            MAIL_TIMEOUT_MS: 200,
          },
        },
      ],
    }).compile();
    const started = Date.now();

    await expect(
      module.get(SmtpMailer).send({
        to: 'a@b.example',
        subject: 's',
        text: 't',
        messageId: '<x@marketplace.local>',
      }),
    ).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(5000);
    sockets.forEach((socket) => socket.destroy());
    silent.close();
    await module.close();
  });
});
