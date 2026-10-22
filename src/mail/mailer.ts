import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Message-ID header: the same id on a repeated send lets a mail client or server spot the copy. */
  messageId: string;
}

/** What the jobs depend on; tests replace it with a recorder. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer extends Mailer implements OnApplicationShutdown {
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    // The library's defaults (2 min to connect, 10 min on a silent socket) outlast the
    // database's idle-in-transaction timeout: a stuck SMTP server would have Postgres kill
    // the receipt's transaction after the mail has already gone out.
    this.transport = nodemailer.createTransport({
      url: env.MAIL_SMTP_URL,
      connectionTimeout: env.MAIL_TIMEOUT_MS,
      greetingTimeout: env.MAIL_TIMEOUT_MS,
      socketTimeout: env.MAIL_TIMEOUT_MS,
    });
  }

  async send({ to, subject, text, messageId }: MailMessage) {
    await this.transport.sendMail({
      from: this.env.MAIL_FROM,
      to,
      subject,
      text,
      messageId,
    });
  }

  onApplicationShutdown() {
    this.transport.close();
  }
}
