import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Último recurso para erros. Duas regras:
 * 1. Erros HTTP conhecidos (400, 404, 409...) saem exatamente como o Nest já os formata.
 * 2. Erros inesperados viram 500 SEM detalhes internos (stack, SQL, nomes de tabela)
 *    na resposta: isso fica só no log, ligado ao requestId que o usuário recebe.
 *    "Erro interno, código abc-123" é o que o suporte precisa para achar o problema.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    this.logger.error(
      { requestId: req.id, method: req.method, path: req.path, error: String(exception) },
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: `Erro interno. Se persistir, informe o código ${req.id} ao suporte.`,
      requestId: req.id,
    });
  }
}
