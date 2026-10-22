import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import { ENV, type Env } from '../config/env.js';
import { rows } from '../db/sql.js';
import { Mailer } from '../mail/mailer.js';
import { banAlertMail } from '../mail/templates.js';

/**
 * Mails the administrator "IP banned". A repeated alert is harmless, so this job needs no
 * marker table: the job id (`ip-ban-<id>`) already stops the queue from holding two, and a
 * crash after the mail but before the job is acknowledged costs one extra mail.
 */
@Injectable()
export class BanAlertJob {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(banId: string) {
    const [ban] = await rows<{
      id: string;
      ip: string;
      banned_from: Date;
      banned_until: Date;
      views: number;
    }>(
      this.dataSource.manager,
      `SELECT id, host(ip) AS ip, banned_from, banned_until, views FROM ip_bans WHERE id = $1`,
      [banId],
    );
    if (!ban) throw new UnrecoverableError(`ban ${banId} not found`);
    await this.mailer.send({
      to: this.env.ADMIN_EMAIL,
      ...banAlertMail({
        id: ban.id,
        ip: ban.ip,
        bannedFrom: ban.banned_from,
        bannedUntil: ban.banned_until,
        views: ban.views,
      }),
    });
  }
}
