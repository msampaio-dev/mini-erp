/**
 * CSV para o Excel em português (ADR 0012, D34):
 * - separador ";" (a vírgula é o separador decimal no Brasil);
 * - números com vírgula decimal e sem separador de milhar;
 * - BOM UTF-8 no início: sem ele, o Excel abre "Café" como "CafÃ©".
 *
 * Segurança: INJEÇÃO DE FÓRMULA (OWASP "CSV Injection"). Texto que começa com = + - @
 * (ou tab/CR) é interpretado como fórmula pelo Excel. Um produto chamado
 * =HYPERLINK("http://malicioso";"clique") viraria um link ativo na planilha.
 * Prefixamos esses textos com apóstrofo, que faz o Excel tratá-los como texto.
 */

export type CsvValue = string | number | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)), ...rows.map((r) => columns.map((c) => cell(c.value(r))))];
  return BOM + lines.map((l) => l.join(';')).join('\r\n') + '\r\n';
}

/** Centavos -> "1234,56" (número para o Excel somar; formatação de moeda fica com a planilha). */
export const centsCell = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
