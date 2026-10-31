/**
 * Carga de demonstração: catálogo e estoque de um supermercado.
 *
 *   npm run seed:demo -w @mini-erp/api            (usa o DATABASE_URL do ambiente)
 *
 * Fica FORA do tsconfig (tsc --noEmit): importa dist/, que não existe num clone limpo (CI).
 *
 * - Importa o código COMPILADO (dist/): o esbuild (usado pelo tsx) não gera os metadados de
 *   decorators que a injeção de dependências do Nest usa.
 * - Roda com `node` (tipos removidos nativamente pelo Node 24), NÃO com tsx: o carregador do tsx
 *   resolvia o @nestjs/core por outro caminho, carregando DUAS cópias do pacote ("dual package
 *   hazard"); o Reflector de uma não era o da outra e a injeção falhava.
 * - Passa pelos SERVIÇOS da aplicação (ProductsService, InventoryService): vale toda regra de
 *   negócio (livro-razão, custo médio, validações, CHECKs), como uma entrada feita pela tela.
 * - Idempotente: produto cujo SKU já existe é pulado (nem recadastra nem soma estoque de novo).
 * - Autor das entradas: usuário "Carga inicial", criado DESATIVADO (não faz login). No kardex
 *   fica claro que o lançamento veio da importação, não de uma pessoa.
 * - Códigos de barras na faixa EAN-13 iniciada em "2", reservada pela GS1 para uso interno
 *   da loja (como os produtos de balança): não coincidem com EANs reais de fabricantes.
 * - Preços: estimativas realistas de varejo (não são cotação do dia).
 */
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Unit } from '@mini-erp/contracts';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/infra/prisma/prisma.service.js';
import { CategoriesService } from '../dist/modules/catalog/categories/categories.service.js';
import { ProductsService } from '../dist/modules/catalog/products/products.service.js';
import { InventoryService } from '../dist/modules/inventory/inventory.service.js';
import { hashPassword } from '../dist/modules/access/password/password.js';

type Item = {
  sku: string;
  name: string;
  unit: Unit;
  price: number; // R$
  min: number;
  /** Entradas de estoque: [quantidade, custo unitário em R$]. Duas entradas = custo médio. */
  entries: [number, number][];
};

const CATALOG: Record<string, Item[]> = {
  Mercearia: [
    { sku: 'ARZ-TJ-5KG', name: 'Arroz Tio João Tipo 1 5kg', unit: 'UN', price: 29.9, min: 20, entries: [[60, 22.4]] },
    { sku: 'ARZ-CAMIL-5KG', name: 'Arroz Camil Tipo 1 5kg', unit: 'UN', price: 27.9, min: 20, entries: [[48, 20.9]] },
    { sku: 'FEJ-KICALDO-1KG', name: 'Feijão Carioca Kicaldo 1kg', unit: 'UN', price: 8.49, min: 24, entries: [[80, 6.1], [40, 6.5]] },
    { sku: 'FEJ-PRETO-CAMIL-1KG', name: 'Feijão Preto Camil 1kg', unit: 'UN', price: 8.99, min: 24, entries: [[60, 6.6]] },
    { sku: 'ACU-UNIAO-1KG', name: 'Açúcar Refinado União 1kg', unit: 'UN', price: 4.99, min: 30, entries: [[100, 3.6]] },
    { sku: 'CAFE-PILAO-500', name: 'Café Pilão Tradicional 500g', unit: 'UN', price: 24.9, min: 24, entries: [[48, 18.2], [24, 19.4]] },
    { sku: 'CAFE-3COR-500', name: 'Café 3 Corações Tradicional 500g', unit: 'UN', price: 22.9, min: 24, entries: [[48, 16.9]] },
    { sku: 'OLEO-SOYA-900', name: 'Óleo de Soja Soya 900ml', unit: 'UN', price: 7.99, min: 36, entries: [[120, 5.8]] },
    { sku: 'MAC-RENATA-ESP-500', name: 'Macarrão Espaguete Renata 500g', unit: 'UN', price: 4.79, min: 30, entries: [[90, 3.3]] },
    { sku: 'MAC-BARILLA-PAR-500', name: 'Macarrão Parafuso Barilla 500g', unit: 'UN', price: 8.49, min: 18, entries: [[40, 6.2]] },
    { sku: 'FAR-DBENTA-1KG', name: 'Farinha de Trigo Dona Benta 1kg', unit: 'UN', price: 5.99, min: 24, entries: [[60, 4.2]] },
    { sku: 'MOL-POMAROLA-340', name: 'Molho de Tomate Pomarola 340g', unit: 'UN', price: 3.49, min: 36, entries: [[120, 2.3]] },
    { sku: 'LCOND-MOCA-395', name: 'Leite Condensado Moça 395g', unit: 'UN', price: 7.99, min: 24, entries: [[72, 5.7]] },
    { sku: 'ACHOC-NESCAU-400', name: 'Achocolatado Nescau 400g', unit: 'UN', price: 9.99, min: 18, entries: [[48, 7.2]] },
    { sku: 'SAL-CISNE-1KG', name: 'Sal Refinado Cisne 1kg', unit: 'UN', price: 2.99, min: 20, entries: [[50, 1.9]] },
  ],
  Bebidas: [
    { sku: 'REF-COCA-2L', name: 'Refrigerante Coca-Cola 2L', unit: 'UN', price: 10.99, min: 36, entries: [[120, 7.9]] },
    { sku: 'REF-GUARANA-2L', name: 'Refrigerante Guaraná Antarctica 2L', unit: 'UN', price: 8.99, min: 36, entries: [[96, 6.3]] },
    { sku: 'AGUA-CRYSTAL-500', name: 'Água Mineral Crystal sem Gás 500ml', unit: 'UN', price: 2.49, min: 48, entries: [[240, 1.4]] },
    { sku: 'CERV-HEINEKEN-LN', name: 'Cerveja Heineken Long Neck 330ml', unit: 'UN', price: 6.99, min: 48, entries: [[144, 4.9]] },
    { sku: 'CERV-BRAHMA-LATA', name: 'Cerveja Brahma Chopp Lata 350ml', unit: 'UN', price: 3.99, min: 72, entries: [[240, 2.7]] },
    { sku: 'SUCO-DELVALLE-UVA-1L', name: 'Suco Del Valle Uva 1L', unit: 'UN', price: 8.99, min: 18, entries: [[36, 6.2]] },
  ],
  Laticínios: [
    { sku: 'LEITE-ITALAC-1L', name: 'Leite UHT Integral Italac 1L', unit: 'UN', price: 5.49, min: 48, entries: [[144, 4.1]] },
    { sku: 'LEITE-PIRACANJUBA-1L', name: 'Leite UHT Integral Piracanjuba 1L', unit: 'UN', price: 5.79, min: 48, entries: [[120, 4.3]] },
    { sku: 'IOG-NESTLE-NAT-170', name: 'Iogurte Natural Nestlé 170g', unit: 'UN', price: 3.29, min: 24, entries: [[60, 2.2]] },
    { sku: 'MANT-AVIACAO-200', name: 'Manteiga Aviação com Sal 200g', unit: 'UN', price: 14.9, min: 12, entries: [[30, 10.9]] },
    { sku: 'REQ-CATUPIRY-200', name: 'Requeijão Cremoso Catupiry 200g', unit: 'UN', price: 11.9, min: 12, entries: [[36, 8.6]] },
  ],
  Frios: [
    { sku: 'FRIO-MUSSARELA-KG', name: 'Queijo Mussarela Fatiado', unit: 'KG', price: 49.9, min: 5, entries: [[18.5, 34.9]] },
    { sku: 'FRIO-PRESUNTO-SADIA-KG', name: 'Presunto Cozido Sadia Fatiado', unit: 'KG', price: 39.9, min: 5, entries: [[15.25, 27.5]] },
    { sku: 'FRIO-MORTADELA-CERATTI-KG', name: 'Mortadela Bologna Ceratti Fatiada', unit: 'KG', price: 44.9, min: 4, entries: [[9.8, 31.2]] },
  ],
  Hortifrúti: [
    { sku: 'HORT-BANANA-PRATA', name: 'Banana Prata', unit: 'KG', price: 6.99, min: 15, entries: [[60.4, 4.1]] },
    { sku: 'HORT-MACA-GALA', name: 'Maçã Gala', unit: 'KG', price: 11.99, min: 10, entries: [[40.2, 7.6]] },
    { sku: 'HORT-TOMATE', name: 'Tomate Italiano', unit: 'KG', price: 8.99, min: 12, entries: [[35.75, 5.4]] },
    { sku: 'HORT-BATATA', name: 'Batata Inglesa', unit: 'KG', price: 5.99, min: 20, entries: [[80, 3.5]] },
    { sku: 'HORT-CEBOLA', name: 'Cebola Nacional', unit: 'KG', price: 5.49, min: 15, entries: [[50, 3.2]] },
    { sku: 'HORT-LARANJA-PERA', name: 'Laranja Pera', unit: 'KG', price: 4.99, min: 20, entries: [[70.3, 2.8]] },
    { sku: 'HORT-ALFACE-CRESPA', name: 'Alface Crespa (pé)', unit: 'UN', price: 3.49, min: 15, entries: [[40, 1.9]] },
  ],
  Açougue: [
    { sku: 'ACG-PEITO-FRANGO', name: 'Peito de Frango Resfriado', unit: 'KG', price: 19.9, min: 15, entries: [[45.6, 13.8]] },
    { sku: 'ACG-COXA-SOBRECOXA', name: 'Coxa e Sobrecoxa de Frango', unit: 'KG', price: 14.9, min: 15, entries: [[38.2, 10.2]] },
    { sku: 'ACG-PATINHO', name: 'Patinho Bovino', unit: 'KG', price: 49.9, min: 8, entries: [[22.35, 36.5]] },
    { sku: 'ACG-CONTRAFILE', name: 'Contrafilé Bovino', unit: 'KG', price: 59.9, min: 8, entries: [[18.9, 43.9]] },
    { sku: 'ACG-LINGUICA-TOSCANA', name: 'Linguiça Toscana Sadia', unit: 'KG', price: 26.9, min: 6, entries: [[14.4, 18.9]] },
  ],
  Padaria: [
    { sku: 'PAD-PAO-FRANCES', name: 'Pão Francês', unit: 'KG', price: 18.9, min: 8, entries: [[25, 8.5]] },
    { sku: 'PAD-PULLMAN-500', name: 'Pão de Forma Pullman Tradicional 500g', unit: 'UN', price: 9.99, min: 12, entries: [[30, 7.1]] },
    { sku: 'PAD-BISNAG-SEVENBOYS', name: 'Bisnaguinha Seven Boys 300g', unit: 'UN', price: 8.49, min: 12, entries: [[24, 6.0]] },
  ],
  Congelados: [
    { sku: 'CONG-PIZZA-SADIA-MUS', name: 'Pizza Sadia Mussarela 460g', unit: 'UN', price: 19.9, min: 10, entries: [[24, 14.2]] },
    { sku: 'CONG-LASANHA-SADIA-BOL', name: 'Lasanha Sadia à Bolonhesa 600g', unit: 'UN', price: 19.9, min: 10, entries: [[20, 14.5]] },
    { sku: 'CONG-HAMB-SEARA-672', name: 'Hambúrguer Seara Bovino 672g', unit: 'UN', price: 22.9, min: 8, entries: [[18, 16.4]] },
  ],
  Limpeza: [
    { sku: 'LIMP-DETERG-YPE-500', name: 'Detergente Ypê Neutro 500ml', unit: 'UN', price: 2.79, min: 36, entries: [[120, 1.8]] },
    { sku: 'LIMP-OMO-1600', name: 'Sabão em Pó Omo Lavagem Perfeita 1,6kg', unit: 'UN', price: 32.9, min: 12, entries: [[30, 24.1]] },
    { sku: 'LIMP-COMFORT-1L', name: 'Amaciante Comfort Original 1L', unit: 'UN', price: 15.9, min: 12, entries: [[30, 11.4]] },
    { sku: 'LIMP-QBOA-2L', name: 'Água Sanitária Qboa 2L', unit: 'UN', price: 7.49, min: 18, entries: [[48, 5.0]] },
  ],
  Higiene: [
    { sku: 'HIG-PAPEL-NEVE-12', name: 'Papel Higiênico Neve Folha Dupla 12 rolos', unit: 'PC', price: 23.9, min: 12, entries: [[36, 17.2]] },
    { sku: 'HIG-COLGATE-TOTAL-90', name: 'Creme Dental Colgate Total 12 90g', unit: 'UN', price: 9.99, min: 24, entries: [[60, 6.9]] },
    { sku: 'HIG-DOVE-90', name: 'Sabonete Dove Original 90g', unit: 'UN', price: 4.99, min: 36, entries: [[96, 3.3]] },
    { sku: 'HIG-SEDA-325', name: 'Shampoo Seda Ceramidas 325ml', unit: 'UN', price: 14.9, min: 12, entries: [[30, 10.3]] },
    { sku: 'HIG-REXONA-150', name: 'Desodorante Rexona Aerosol Men 150ml', unit: 'UN', price: 17.9, min: 12, entries: [[24, 12.6]] },
  ],
};

/** EAN-13 de uso interno (prefixo "2", reservado pela GS1 à loja) com dígito verificador. */
function internalEan(seq: number): string {
  const body = `2${String(seq).padStart(11, '0')}`;
  const sum = [...body].reverse().reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const cents = (reais: number) => Math.round(reais * 100);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const categories = app.get(CategoriesService);
    const products = app.get(ProductsService);
    const inventory = app.get(InventoryService);

    // Autor das entradas: usuário de sistema, DESATIVADO (senha aleatória que ninguém conhece).
    const importer = await prisma.user.upsert({
      where: { email: 'carga-inicial@sistema.local' },
      update: {},
      create: {
        name: 'Carga inicial (sistema)',
        email: 'carga-inicial@sistema.local',
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        active: false,
      },
    });

    const existingCats = new Map((await categories.list()).map((c) => [c.name.toLowerCase(), c.id]));
    let seq = 1;
    const summary = { created: 0, skipped: 0, entries: 0, units: 0, kg: 0, costCents: 0 };

    for (const [categoryName, items] of Object.entries(CATALOG)) {
      const categoryId =
        existingCats.get(categoryName.toLowerCase()) ?? (await categories.create({ name: categoryName })).id;

      for (const item of items) {
        const barcode = internalEan(seq++);
        const exists = await prisma.product.count({ where: { sku: item.sku } });
        if (exists) {
          summary.skipped++;
          continue;
        }
        const product = await products.create({
          sku: item.sku,
          name: item.name,
          description: '',
          unit: item.unit,
          barcode,
          categoryId,
          salePriceCents: cents(item.price),
          minStock: item.min,
        });
        summary.created++;

        for (const [quantity, cost] of item.entries) {
          await inventory.registerEntry(
            { productId: product.id, quantity, unitCostCents: cents(cost), note: 'Carga inicial (demonstração)' },
            importer.id,
            randomUUID(),
          );
          summary.entries++;
          summary.costCents += Math.round(quantity * cents(cost));
          if (item.unit === 'KG') summary.kg += quantity;
          else summary.units += quantity;
        }
      }
    }

    console.log(
      JSON.stringify({
        produtosCriados: summary.created,
        produtosJaExistentes: summary.skipped,
        entradasDeEstoque: summary.entries,
        unidades: summary.units,
        quilos: Number(summary.kg.toFixed(3)),
        valorEmEstoqueACusto: `R$ ${(summary.costCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      }),
    );
  } finally {
    await app.close();
  }
}

await main();
