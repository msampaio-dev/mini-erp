/**
 * Cálculos de venda em centavos inteiros (ADR 0004 / ADR 0011).
 * Compartilhado entre API (autoridade) e front (prévia do carrinho): a mesma conta nos dois lados.
 *
 * Usa BigInt nas multiplicações: quantidade em milésimos × preço em centavos pode passar
 * de 2^53, onde o `number` do JavaScript começa a perder precisão em silêncio.
 */

/** Divisão inteira arredondando metade para cima (valores não negativos). */
const divRound = (num: bigint, den: bigint) => (num * 2n + den) / (den * 2n);

/** Valor bruto da linha: quantidade (até 3 casas) × preço unitário, arredondado ao centavo. */
export function lineGrossCents(quantity: number, unitPriceCents: number): number {
  const milli = BigInt(Math.round(quantity * 1000));
  return Number(divRound(milli * BigInt(unitPriceCents), 1000n));
}

export type SaleDiscount = { type: 'AMOUNT'; valueCents: number } | { type: 'PERCENT'; percent: number };

/** Desconto total em centavos. Percentual aceita até 2 casas (12,5%). */
export function discountCents(subtotalCents: number, discount: SaleDiscount | null | undefined): number {
  if (!discount) return 0;
  if (discount.type === 'AMOUNT') return discount.valueCents;
  const basisPoints = BigInt(Math.round(discount.percent * 100)); // 12,5% = 1250 bp
  return Number(divRound(BigInt(subtotalCents) * basisPoints, 10_000n));
}

/**
 * Rateia `total` centavos entre as linhas, proporcional aos pesos, pelo método do MAIOR RESTO:
 * 1. cada linha recebe a parte inteira (piso) da sua fatia;
 * 2. os centavos que sobram vão, um a um, para as linhas com maior parte fracionária.
 * Garante soma EXATA, sem o centavo "perdido" ou "a mais" do arredondamento linha a linha.
 *
 * Ex.: R$ 0,10 entre 3 linhas iguais -> [4, 3, 3] (e não [3, 3, 3] = 9).
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);

  const bigTotal = BigInt(total);
  const bigSum = BigInt(sum);
  const shares = weights.map((w, index) => {
    const numerator = bigTotal * BigInt(w);
    return { index, floor: numerator / bigSum, remainder: numerator % bigSum };
  });

  let leftover = bigTotal - shares.reduce((acc, s) => acc + s.floor, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    share.floor += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => Number(s.floor));
}

export interface SaleTotals {
  lines: { grossCents: number; discountCents: number; netCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/** Totais completos da venda. Lança erro se o desconto passar do subtotal. */
export function computeSaleTotals(
  lines: { quantity: number; unitPriceCents: number }[],
  discount?: SaleDiscount | null,
): SaleTotals {
  const gross = lines.map((l) => lineGrossCents(l.quantity, l.unitPriceCents));
  const subtotalCents = gross.reduce((a, b) => a + b, 0);
  const totalDiscount = discountCents(subtotalCents, discount);
  if (totalDiscount > subtotalCents) {
    throw new RangeError('O desconto não pode ser maior que o subtotal');
  }
  const perLine = allocateProportionally(totalDiscount, gross);
  return {
    lines: gross.map((g, i) => ({ grossCents: g, discountCents: perLine[i]!, netCents: g - perLine[i]! })),
    subtotalCents,
    discountCents: totalDiscount,
    totalCents: subtotalCents - totalDiscount,
  };
}

/**
 * Reembolso de uma devolução parcial (ADR 0019): proporcional ao valor LÍQUIDO pago pelo item
 * (o desconto da venda já está rateado nele).
 *
 * Calculado pelo ACUMULADO: reembolso = arred(líquido × devolvido_total / vendido) − já_reembolsado.
 * Arredondar cada devolução isoladamente erra para cima: R$ 5,00 por 10 unidades (R$ 0,50 cada)
 * devolvidas uma a uma dariam R$ 1,00 por vez, R$ 9,00 em nove devoluções. Pelo acumulado, a soma
 * nunca passa do líquido, e devolver tudo reembolsa exatamente o que foi pago.
 */
export function returnRefundCents(
  item: {
    netCents: number;
    quantity: number;
    returnedQuantity: number;
    refundedCents: number;
  },
  quantity: number,
): number {
  const sold = BigInt(Math.round(item.quantity * 1000));
  const after = BigInt(Math.round((item.returnedQuantity + quantity) * 1000));
  return Number(divRound(BigInt(item.netCents) * after, sold)) - item.refundedCents;
}

export type PaymentLine = { method: 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT'; amountCents: number };

export interface PaymentSettlement {
  receivedCents: number;
  changeCents: number;
  /** Quanto de dinheiro FICA na gaveta: entregue em dinheiro − troco. */
  cashNetCents: number;
}

/**
 * Fecha a conta de um pagamento dividido (D45). Duas regras bastam:
 * 1. Cartão e Pix somados não passam do total: troco só existe em dinheiro.
 * 2. Tudo somado cobre o total.
 * Com elas, o troco (recebido − total) nunca passa do valor entregue em dinheiro.
 * Lança RangeError com a mensagem para o usuário.
 */
export function settlePayments(totalCents: number, payments: PaymentLine[]): PaymentSettlement {
  const cash = payments.find((p) => p.method === 'CASH')?.amountCents ?? 0;
  const received = payments.reduce((a, p) => a + p.amountCents, 0);
  if (received - cash > totalCents)
    throw new RangeError('Cartão e Pix não podem passar do total: troco só em dinheiro');
  if (received < totalCents) throw new RangeError('Valor pago menor que o total');
  const changeCents = received - totalCents;
  return { receivedCents: received, changeCents, cashNetCents: cash - changeCents };
}
