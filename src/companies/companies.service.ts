import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { rows } from '../db/sql.js';
import type { CreateCompany } from './companies.schemas.js';

export interface CompanyRow {
  id: string;
  name: string;
  email: string;
  balance: string;
}

@Injectable()
export class CompaniesService {
  constructor(private readonly dataSource: DataSource) {}

  /** A company and its wallet appear together; there is no company without one. */
  create({ name, email }: CreateCompany) {
    return this.dataSource.transaction(async (em) => {
      const [company] = await rows<{ id: string }>(
        em,
        `INSERT INTO companies (name, email) VALUES ($1, $2) RETURNING id`,
        [name, email],
      );
      await rows(em, `INSERT INTO wallets (company_id) VALUES ($1)`, [
        company.id,
      ]);
      return { id: company.id, name, email, balance: '0' };
    });
  }

  async get(id: string) {
    const [company] = await rows<CompanyRow>(
      this.dataSource.manager,
      `SELECT c.id, c.name, c.email, w.balance
         FROM companies c JOIN wallets w ON w.company_id = c.id
        WHERE c.id = $1`,
      [id],
    );
    if (!company) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'COMPANY_NOT_FOUND',
        'Компания не найдена',
      );
    }
    // balance stays a string (bigint): it can exceed Number.MAX_SAFE_INTEGER.
    return company;
  }
}
