import { z } from 'zod';

/**
 * Postgres returns uuids in lower case, and services compare ids from the body
 * with ids read from the database. Normalising here keeps `3F25...` and `3f25...`
 * the same company everywhere.
 */
export const uuid = () => z.uuid().transform((id) => id.toLowerCase());
