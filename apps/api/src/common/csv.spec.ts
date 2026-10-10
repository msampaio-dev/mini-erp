import { centsCell, toCsv } from './csv.js';

type Row = { name: string; qty: number; cents: number };
const columns = [
  { header: 'Produto', value: (r: Row) => r.name },
  { header: 'Qtd', value: (r: Row) => r.qty },
  { header: 'Valor', value: (r: Row) => centsCell(r.cents) },
];

describe('toCsv', () => {
  it('BOM, separador ";", vírgula decimal e CRLF', () => {
    const csv = toCsv(columns, [{ name: 'Café', qty: 2.5, cents: 123456 }]);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe('Produto;Qtd;Valor\r\nCafé;2,5;1234,56\r\n');
  });

  it('coloca entre aspas campos com ";", aspas ou quebra de linha', () => {
    const csv = toCsv(columns, [{ name: 'Caneta "BIC"; azul', qty: 1, cents: 0 }]);

    expect(csv).toContain('"Caneta ""BIC""; azul";1;0,00');
  });

  it('neutraliza injeção de fórmula (OWASP CSV Injection)', () => {
    const csv = toCsv(columns, [
      { name: '=HYPERLINK("http://malicioso";"clique")', qty: 1, cents: 0 },
      { name: '+55 11 9999', qty: 1, cents: 0 },
      { name: '@SUM(A1)', qty: 1, cents: 0 },
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""http://malicioso"";""clique"")"`);
    expect(csv).toContain("'+55 11 9999");
    expect(csv).toContain("'@SUM(A1)");
  });

  it('números negativos continuam números (não são texto de fórmula)', () => {
    const csv = toCsv(columns, [{ name: 'Ajuste', qty: -3, cents: 0 }]);

    expect(csv).toContain('Ajuste;-3;0,00');
  });
});
