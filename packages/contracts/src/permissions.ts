/**
 * Catálogo de permissões: fonte da verdade em código.
 * O seed sincroniza esta lista com o banco; papéis são combinações dela.
 * Formato: "<recurso>:<ação>".
 */
export const PERMISSIONS = {
  'usuarios:gerenciar': 'Criar, listar e desativar usuários',
  'produtos:ler': 'Consultar produtos',
  'produtos:gerenciar': 'Cadastrar e editar produtos',
  'estoque:ler': 'Consultar saldo e movimentações',
  'estoque:entrada': 'Registrar entradas de mercadoria',
  'estoque:ajustar': 'Registrar ajustes (avaria, inventário)',
  'vendas:criar': 'Registrar vendas',
  'vendas:ler': 'Consultar vendas',
  'vendas:cancelar': 'Cancelar vendas',
  'relatorios:ler': 'Acessar relatórios',
  'caixa:operar': 'Abrir, movimentar e fechar o próprio caixa',
  'caixa:gerenciar': 'Ver todos os caixas, com valores esperados e diferenças',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
