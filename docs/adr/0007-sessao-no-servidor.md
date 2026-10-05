# ADR 0007: Sessão no servidor com cookie httpOnly

- **Status:** aceito
- **Data:** 2026-10-05

## Contexto
Usuários de um ERP mudam de papel e são desligados. Quando alguém é desativado,
o acesso precisa cair **na hora**, não quando um token expirar.

## Decisão
- Login cria uma sessão na tabela `sessions`. O navegador recebe um token aleatório de 256 bits
  num cookie `erp_session` (`HttpOnly`, `SameSite=Lax`, `Secure` em produção).
- O banco guarda apenas o **SHA-256 do token**: um dump vazado não permite sequestrar sessões.
- Expiração **deslizante** (`SESSION_TTL_HOURS`, padrão 8h de inatividade). A renovação só grava
  no banco depois de passada metade do TTL, para não gerar um UPDATE a cada request.
- Desativar um usuário apaga as sessões dele **na mesma transação**.
- Senhas com **Argon2id** nativo do Node 24 (`crypto.argon2`), parâmetros OWASP
  (19 MiB, t=2, p=1), formato PHC. O `needsRehash` permite endurecer os parâmetros no futuro:
  o hash é atualizado no próximo login.
- Login: mensagem única para e-mail inexistente e senha errada, com Argon2 contra um hash falso
  quando o e-mail não existe (o tempo de resposta não revela quais e-mails existem). Limite de
  `LOGIN_RATE_LIMIT` tentativas por IP por minuto (`@nestjs/throttler`).

## Alternativas consideradas
- **JWT stateless:** não dá para revogar antes de expirar sem criar uma *denylist*,
  que é justamente uma sessão no servidor com mais passos.
- **Token em localStorage:** fica legível por qualquer script na página (XSS).
- **bcrypt / pacote argon2:** o Argon2id é o recomendado pela OWASP, e a versão nativa
  evita dependências com binário e scripts de instalação.

## Consequências
- Uma consulta ao banco por request autenticado. Aceitável no volume de um mini-ERP;
  se virar gargalo, um cache curto (Redis) resolve.
- CSRF mitigado pelo `SameSite=Lax`: o navegador não envia o cookie em POST de outros sites.
- O rate limit é em memória: com várias instâncias, migrar o storage para Redis.
- Atrás de um proxy reverso, configurar `trust proxy` no Express para o IP do cliente ser o real
  (a ser feito na fase de deploy).
