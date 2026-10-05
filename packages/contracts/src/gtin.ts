/**
 * Valida códigos de barras GTIN (EAN-8, UPC-12, EAN-13, GTIN-14) pelo dígito verificador.
 * Algoritmo: da direita para a esquerda (sem o verificador), pesos alternados 3 e 1;
 * o verificador é o que falta para a soma chegar ao próximo múltiplo de 10.
 */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;

  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}
