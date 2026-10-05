import { z } from 'zod';

/** Parâmetros de paginação vindos da query string (por isso o coerce: tudo chega como texto). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
