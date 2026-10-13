import type { EntityManager } from 'typeorm';

/**
 * Runs a parameterised statement and always returns its rows. EntityManager.query
 * returns plain rows for SELECT/INSERT but `[rows, affectedCount]` for
 * UPDATE/DELETE; a row is never an array, so the two shapes are unambiguous.
 */
export async function rows<T>(
  em: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await em.query(sql, params);
  return Array.isArray(result[0]) ? result[0] : result;
}
