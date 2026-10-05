import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IDEMPOTENCY_HEADER } from '@mini-erp/contracts';

const keySchema = z.uuid();

/**
 * Lê o cabeçalho Idempotency-Key (UUID gerado pelo cliente por operação).
 * Obrigatório nas escritas de estoque: sem ele, um clique duplo ou um retry de rede
 * lançaria a mesma entrada duas vezes (ADR 0010).
 */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const value = ctx.switchToHttp().getRequest<Request>().get(IDEMPOTENCY_HEADER);
  const parsed = keySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: `Envie o cabeçalho ${IDEMPOTENCY_HEADER} com um UUID único por operação`,
    });
  }
  return parsed.data;
});
