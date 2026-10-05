import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * Valida (e transforma) a entrada com um schema Zod de @mini-erp/contracts.
 * O mesmo schema valida o formulário no front: regra escrita uma vez só.
 *
 * Uso: @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductInput
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
