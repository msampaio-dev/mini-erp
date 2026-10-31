/**
 * Simulação de um dia de operação do mercado, com VERIFICAÇÃO automática de cada cenário.
 *
 *   npm run simulate:day -w @mini-erp/api      (usa o DATABASE_URL do ambiente)
 *
 * Pré-requisito: a carga do mercado (npm run seed:demo). Cada execução ADICIONA novas vendas e
 * movimentações (não é idempotente, de propósito: simula mais um dia).
 *
 * Usa os SERVIÇOS da aplicação (vendas, estoque, relatórios): valem todas as regras de negócio.
 * Autor: usuário "Simulação de testes (sistema)", DESATIVADO (não faz login).
 * Fica fora do tsconfig e roda com `node` pelos mesmos motivos do seed-demo-market.ts.
 */
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { computeSaleTotals, type CreateSaleInput, type PaymentMethod } from '@mini-erp/contracts';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/infra/prisma/prisma.service.js';
import { ProductsService } from '../dist/modules/catalog/products/products.service.js';
import { InventoryService } from '../dist/modules/inventory/inventory.service.js';
import { SalesService } from '../dist/modules/sales/sales.service.js';
import { ReportsService } from '../dist/modules/reports/reports.service.js';
import { hashPassword } from '../dist/modules/access/password/password.js';

type Line = [sku: string, quantity: number];
type Result = { cenario: string; ok: boolean; detalhe: string };

const results: Result[] = [];
const check = (cenario: string, ok: boolean, detalhe: string) => results.push({ cenario, ok, detalhe });
const brl = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const errCode = (err: unknown) => (err as { response?: { code?: string } })?.response?.code ?? String(err);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const products = app.get(ProductsService);
    const inventory = app.get(InventoryService);
    const sales = app.get(SalesService);
    const reports = app.get(ReportsService);

    const user = await prisma.user.upsert({
      where: { email: 'simulacao@sistema.local' },
      update: {},
      create: {
        name: 'Simulação de testes (sistema)',
        email: 'simulacao@sistema.local',
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        active: false,
      },
    });

    const all = await prisma.product.findMany({ select: { id: true, sku: true } });
    const id = new Map(all.map((p) => [p.sku, p.id]));
    const need = (sku: string) => {
      const v = id.get(sku);
      if (!v) throw new Error(`Produto ${sku} não encontrado: rode antes o seed:demo`);
      return v;
    };
    const qty = async (sku: string) => (await inventory.getBalances([need(sku)]))[0]!.quantity;
    const avg = async (sku: string) => (await inventory.getBalances([need(sku)]))[0]!.avgCostCents;
    const sell = (lines: Line[], method: PaymentMethod, extra: Partial<CreateSaleInput> = {}, key = randomUUID()) =>
      sales.create(
        {
          items: lines.map(([sku, quantity]) => ({ productId: need(sku), quantity })),
          discount: null,
          payment: { method },
          note: 'Simulação de testes',
          ...extra,
        } as CreateSaleInput,
        user.id,
        key,
      ).then((r) => r.sale);

    // ─── 1. Vendas comuns (cestas variadas, todas as formas de pagamento) ─────
    const baskets: [Line[], PaymentMethod][] = [
      [[['ARZ-TJ-5KG', 1], ['FEJ-KICALDO-1KG', 2], ['OLEO-SOYA-900', 1], ['ACU-UNIAO-1KG', 1]], 'PIX'],
      [[['REF-COCA-2L', 2], ['CERV-BRAHMA-LATA', 12], ['CONG-PIZZA-SADIA-MUS', 1]], 'CREDIT'],
      [[['LEITE-ITALAC-1L', 6], ['PAD-PULLMAN-500', 1], ['MANT-AVIACAO-200', 1], ['CAFE-PILAO-500', 1]], 'DEBIT'],
      [[['HIG-PAPEL-NEVE-12', 1], ['LIMP-DETERG-YPE-500', 3], ['LIMP-OMO-1600', 1], ['HIG-COLGATE-TOTAL-90', 2]], 'PIX'],
      [[['CERV-HEINEKEN-LN', 6], ['AGUA-CRYSTAL-500', 6], ['ACHOC-NESCAU-400', 1]], 'CREDIT'],
      [[['MAC-RENATA-ESP-500', 2], ['MOL-POMAROLA-340', 2], ['FAR-DBENTA-1KG', 1], ['SAL-CISNE-1KG', 1]], 'DEBIT'],
    ];
    const before1 = await qty('CERV-BRAHMA-LATA');
    let soldCount = 0;
    for (const [lines, method] of baskets) {
      await sell(lines, method);
      soldCount++;
    }
    const after1 = await qty('CERV-BRAHMA-LATA');
    check('1. Vendas comuns', soldCount === baskets.length && before1 - after1 === 12,
      `${soldCount} vendas (Pix, crédito, débito); Brahma ${before1} → ${after1} (−12)`);

    // ─── 2. Desconto em % e em R$: rateio exato entre os itens ────────────────
    const pct = await sell([['CAFE-3COR-500', 2], ['LCOND-MOCA-395', 3], ['REQ-CATUPIRY-200', 1]], 'PIX', {
      discount: { type: 'PERCENT', percent: 10 },
    });
    const amt = await sell([['SUCO-DELVALLE-UVA-1L', 2], ['IOG-NESTLE-NAT-170', 4], ['MAC-BARILLA-PAR-500', 1]], 'DEBIT', {
      discount: { type: 'AMOUNT', valueCents: 500 },
    });
    const sumDisc = (s: typeof pct) => s.items.reduce((a, i) => a + i.discountCents, 0);
    const sumNet = (s: typeof pct) => s.items.reduce((a, i) => a + i.netCents, 0);
    check('2. Descontos (10% e R$ 5,00)',
      sumDisc(pct) === pct.discountCents && sumNet(pct) === pct.totalCents &&
        amt.discountCents === 500 && sumDisc(amt) === 500 && sumNet(amt) === amt.totalCents,
      `10%: ${brl(pct.subtotalCents)} − ${brl(pct.discountCents)} = ${brl(pct.totalCents)} | R$5: ${brl(amt.subtotalCents)} → ${brl(amt.totalCents)} | soma dos itens bate`);

    // ─── 3. Pesáveis (kg fracionado) e dinheiro com troco ─────────────────────
    const bananaBefore = await qty('HORT-BANANA-PRATA');
    const kgLines: Line[] = [['HORT-BANANA-PRATA', 1.235], ['ACG-PATINHO', 0.875], ['PAD-PAO-FRANCES', 0.45], ['FRIO-MUSSARELA-KG', 0.3]];
    const prices = new Map((await products.getMany(kgLines.map(([s]) => need(s)))).map((p) => [p.id, p.salePriceCents]));
    const expected = computeSaleTotals(kgLines.map(([s, q]) => ({ quantity: q, unitPriceCents: prices.get(need(s))! })));
    const cash = await sell(kgLines, 'CASH', { payment: { method: 'CASH', receivedCents: 10_000 } });
    const bananaAfter = await qty('HORT-BANANA-PRATA');
    check('3. Pesáveis + dinheiro com troco',
      cash.totalCents === expected.totalCents && cash.changeCents === 10_000 - cash.totalCents &&
        Math.abs(bananaBefore - bananaAfter - 1.235) < 1e-9,
      `total ${brl(cash.totalCents)}, recebido R$ 100,00, troco ${brl(cash.changeCents)}; banana −1,235 kg`);

    // ─── 4. Compras (reposição) com custo diferente: custo médio ──────────────
    const qCafe = await qty('CAFE-PILAO-500');
    const aCafe = await avg('CAFE-PILAO-500');
    await inventory.registerEntry({ productId: need('CAFE-PILAO-500'), quantity: 36, unitCostCents: 2050, note: 'NF 4471 — Distribuidora' }, user.id, randomUUID());
    await inventory.registerEntry({ productId: need('REF-COCA-2L'), quantity: 48, unitCostCents: 815, note: 'NF 4472 — Distribuidora' }, user.id, randomUUID());
    await inventory.registerEntry({ productId: need('HORT-TOMATE'), quantity: 22.6, unitCostCents: 510, note: 'Ceasa' }, user.id, randomUUID());
    const expectedAvg = Math.round(((qCafe * aCafe + 36 * 2050) / (qCafe + 36)) * 10_000) / 10_000;
    const newAvg = await avg('CAFE-PILAO-500');
    check('4. Compras e custo médio', Math.abs(newAvg - expectedAvg) < 0.0001,
      `Café Pilão: ${qCafe} un a ${brl(Math.round(aCafe))} + 36 a R$ 20,50 → custo médio ${(newAvg / 100).toFixed(4)} (esperado ${(expectedAvg / 100).toFixed(4)})`);

    // ─── 5. Ajustes: avaria (saída) e sobra de inventário (entrada) ───────────
    const tomBefore = await qty('HORT-TOMATE');
    const detBefore = await qty('LIMP-DETERG-YPE-500');
    await inventory.registerAdjustment({ productId: need('HORT-TOMATE'), quantity: -2.35, reason: 'AVARIA', note: 'Tomates amassados no recebimento' }, user.id, randomUUID());
    await inventory.registerAdjustment({ productId: need('LIMP-DETERG-YPE-500'), quantity: 3, reason: 'INVENTARIO', note: 'Contagem achou 3 a mais' }, user.id, randomUUID());
    check('5. Ajustes (avaria e inventário)',
      Math.abs(tomBefore - (await qty('HORT-TOMATE')) - 2.35) < 1e-9 && (await qty('LIMP-DETERG-YPE-500')) - detBefore === 3,
      'Tomate −2,350 kg (avaria); Detergente +3 (inventário)');

    // ─── 6. Compra lançada errada e estornada ─────────────────────────────────
    const gQ = await qty('REF-GUARANA-2L');
    const gA = await avg('REF-GUARANA-2L');
    const wrong = await inventory.registerEntry({ productId: need('REF-GUARANA-2L'), quantity: 480, unitCostCents: 63, note: 'Digitado errado: 480 a R$ 0,63' }, user.id, randomUUID());
    await inventory.reverse(wrong.movement.id, { note: 'Quantidade e custo digitados errados' }, user.id, randomUUID());
    check('6. Estorno de compra errada', (await qty('REF-GUARANA-2L')) === gQ && Math.abs((await avg('REF-GUARANA-2L')) - gA) < 0.0001,
      `Guaraná voltou a ${gQ} un e ao custo médio original após o estorno`);

    // ─── 7. Cancelamento de venda devolve o estoque ───────────────────────────
    const hBefore = await qty('CERV-HEINEKEN-LN');
    const toCancel = await sell([['CERV-HEINEKEN-LN', 12]], 'CREDIT');
    const hMid = await qty('CERV-HEINEKEN-LN');
    const canceled = await sales.cancel(toCancel.id, { reason: 'Cliente desistiu no caixa' }, user.id);
    check('7. Cancelamento devolve estoque',
      hMid === hBefore - 12 && (await qty('CERV-HEINEKEN-LN')) === hBefore && canceled.status === 'CANCELED',
      `Heineken ${hBefore} → ${hMid} (venda nº ${toCancel.number}) → ${hBefore} (cancelada)`);

    // ─── 8. Venda sem estoque: recusada POR INTEIRO (atomicidade) ─────────────
    const arrozBefore = await qty('ARZ-CAMIL-5KG');
    const salesBefore = await prisma.sale.count();
    let code = '';
    try {
      await sell([['ARZ-CAMIL-5KG', 2], ['ACG-CONTRAFILE', 500]], 'PIX');
    } catch (err) {
      code = errCode(err);
    }
    check('8. Venda sem estoque é recusada inteira',
      code === 'INSUFFICIENT_STOCK' && (await qty('ARZ-CAMIL-5KG')) === arrozBefore && (await prisma.sale.count()) === salesBefore,
      `500 kg de contrafilé recusado (${code}); arroz da mesma venda NÃO foi baixado; nenhuma venda gravada`);

    // ─── 9. Concorrência: 10 vendas simultâneas disputando 5 unidades ─────────
    const bis = 'PAD-BISNAG-SEVENBOYS';
    const bisNow = await qty(bis);
    if (bisNow > 5) {
      await inventory.registerAdjustment({ productId: need(bis), quantity: -(bisNow - 5), reason: 'INVENTARIO', note: 'Contagem: só restam 5' }, user.id, randomUUID());
    }
    const race = await Promise.allSettled(Array.from({ length: 10 }, () => sell([[bis, 1]], 'PIX')));
    const won = race.filter((r) => r.status === 'fulfilled').length;
    const lost = race.filter((r) => r.status === 'rejected' && errCode(r.reason) === 'INSUFFICIENT_STOCK').length;
    check('9. Concorrência (10 vendas × 5 unidades)', won === 5 && lost === 5 && (await qty(bis)) === 0,
      `${won} vendidas, ${lost} recusadas por falta de estoque, saldo final ${await qty(bis)}`);

    // ─── 10. Clique duplo: mesma chave = uma venda só ─────────────────────────
    const key = randomUUID();
    const salesBefore10 = await prisma.sale.count();
    const [a, b] = await Promise.all([
      sell([['SAL-CISNE-1KG', 1]], 'PIX', {}, key),
      sell([['SAL-CISNE-1KG', 1]], 'PIX', {}, key),
    ]);
    check('10. Clique duplo (idempotência)',
      a.id === b.id && (await prisma.sale.count()) === salesBefore10 + 1,
      `dois envios simultâneos → venda nº ${a.number} uma única vez`);

    // ─── 11. Relatório de reposição enxerga o que zerou ───────────────────────
    const reorder = await reports.reorder();
    const inReorder = reorder.find((r) => r.sku === bis);
    check('11. Relatório de reposição', !!inReorder && inReorder.quantity === 0,
      `${reorder.length} produto(s) para repor; Bisnaguinha: saldo ${inReorder?.quantity}, faltam ${inReorder?.missing}`);

    // ─── Resumo do dia ────────────────────────────────────────────────────────
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const day = await reports.sales({ from: today, to: today, granularity: 'day' });
    console.log('\nCENÁRIO'.padEnd(46) + 'RESULTADO');
    for (const r of results) console.log(`${r.cenario.padEnd(45)} ${r.ok ? 'PASSOU' : 'FALHOU'}  ${r.detalhe}`);
    console.log(
      `\nDia ${today}: ${day.totals.salesCount} vendas concluídas, ${day.totals.canceledCount} cancelada(s), ` +
        `receita ${brl(day.totals.netCents)}, margem ${brl(day.totals.marginCents)} (${day.totals.marginPct}%), ticket médio ${brl(day.totals.avgTicketCents)}`,
    );
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n${failed} CENÁRIO(S) FALHARAM` : `\nTODOS OS ${results.length} CENÁRIOS PASSARAM`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await app.close();
  }
}

await main();
