# ADR 0017: Backup automático e criptografado da produção

- **Status:** aceito
- **Data:** 2026-11-01
- **Complementa:** ADR 0013 (backup da stack Docker), ADR 0015 (Render + Neon)

## Contexto
No Render gratuito não há onde rodar o serviço de backup da stack Docker. Sobrava o histórico curto
do Neon e um `pg_dump` manual, que dependia de alguém lembrar de rodar. Para uso real, isso não basta.
O repositório é **público**: artefatos e logs de Actions também são acessíveis publicamente.

## Decisão
Workflow `.github/workflows/backup.yml`, diário às 03:00 (Brasília) e manual sob demanda:

1. **Dump com um usuário SÓ LEITURA** (`backup_reader`, `pg_read_all_data`). Se o secret vazar, ninguém
   altera nem apaga dados com ele. Testado: leitura ok, escrita recusada (`permission denied`).
2. **Certificado validado** (`sslmode=verify-full` + `PGSSLROOTCERT=system`). A libpq, diferente do
   driver Node, exige um arquivo de raiz para validar; sem isso ela **recusa** conectar, e o certo é
   apontá-la para as autoridades do sistema, nunca afrouxar o `sslmode`.
3. **Restauração + invariantes a cada execução** (`deploy/backup-invariants.sql`):
   - existe o schema;
   - existem as permissões;
   - total das vendas = soma dos itens;
   - nenhum saldo negativo;
   - **saldo = soma do livro-razão**.

   Backup que não restaura faz o job falhar, e o GitHub avisa por e-mail.
4. **Criptografia assimétrica (age)** com a chave **pública** do repositório
   (`deploy/backup-public-key.txt`). Só a chave **privada**, que fica fora do GitHub com o dono,
   decifra. Testado: o arquivo cifrado não contém nenhum texto legível do banco; o decifrado é
   idêntico ao original (SHA-256); sem a chave, não abre.
5. **Logs sem dados nem contagens:** números de vendas e produtos revelariam o volume do negócio.
6. Artefato por **30 dias**.

## Restaurar um backup

```bash
gh run list --workflow backup.yml --repo msampaio-dev/mini-erp            # escolher a execução
gh run download <id> --repo msampaio-dev/mini-erp                         # baixa o .dump.age
docker run --rm -v "$PWD:/w" -v "$HOME/mini-erp-backup-CHAVE-PRIVADA.txt:/k:ro" alpine \
  sh -c 'apk add -q age && age -d -i /k -o /w/db.dump /w/<arquivo>.dump.age'
pg_restore --no-owner --no-privileges -d "<URL do banco de destino>" db.dump
```

## Riscos e cuidados
- **A chave privada é o ponto crítico.** Perdê-la torna **todos** os backups inúteis; vazá-la permite
  ler todos eles. Guarde-a num gerenciador de senhas **e** numa cópia offline. Se vazar: gerar novo
  par, trocar a chave pública no repositório e apagar os artefatos antigos.
- **Retenção de 30 dias, no mesmo provedor do código** (GitHub). Protege contra perda do banco, não
  contra perda da conta do GitHub. Para dados críticos, copie periodicamente alguns backups
  (já cifrados) para outro lugar.
- **O GitHub desativa workflows agendados de repositório público após 60 dias sem atividade.** Se o
  repositório ficar parado, reative em Actions → Backup do banco.
- O workflow só lê: não há como ele alterar a produção.
