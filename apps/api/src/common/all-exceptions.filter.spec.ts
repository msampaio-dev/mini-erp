import { ConflictException, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function host() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = { id: 'req-123456', method: 'POST', path: '/api/sales' };
  const h = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ArgumentsHost;
  return { h, res };
}

describe('AllExceptionsFilter', () => {
  it('erros HTTP conhecidos passam com o corpo original (inclusive code)', () => {
    const { h, res } = host();

    new AllExceptionsFilter().catch(new ConflictException({ code: 'ALREADY_CANCELED', message: 'Já cancelada' }), h);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ code: 'ALREADY_CANCELED', message: 'Já cancelada' });
  });

  it('erro inesperado vira 500 com requestId e SEM detalhes internos', () => {
    const { h, res } = host();
    const filter = new AllExceptionsFilter();
    const logged = vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('relation "sales" violates constraint xyz at line 42'), h);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: 500, requestId: 'req-123456' });
    expect(JSON.stringify(body)).not.toContain('sales');
    expect(JSON.stringify(body)).not.toContain('line 42');
    // ...mas o detalhe está no log, ligado ao mesmo requestId.
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-123456' }), expect.any(String));
  });
});
