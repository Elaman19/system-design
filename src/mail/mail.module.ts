import { Module } from '@nestjs/common';
import { Mailer, SmtpMailer } from './mailer.js';

@Module({
  providers: [{ provide: Mailer, useClass: SmtpMailer }],
  exports: [Mailer],
})
export class MailModule {}
