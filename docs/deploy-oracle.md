# Deploy na Oracle Cloud (Always Free)

Complementa o [guia geral de deploy](deploy.md). Roda o `docker-compose.prod.yml` sem nenhuma
mudança numa VM ARM gratuita da Oracle.

> **Limites conferidos em out/2026:** a Oracle reduziu o Always Free ARM para **2 OCPU e 12 GB
> de RAM no total** (antes eram 4 e 24). Confira os números atuais na documentação oficial antes
> de criar a máquina. Regras de plano gratuito mudam sem aviso: para uso comercial, prefira uma
> VPS paga (o guia geral serve igual).

---

## Parte A: o que só você pode fazer (cadastro e painel)

### A1. Criar a conta
1. Acesse **cloud.oracle.com** e crie uma conta *Free Tier*. Pede cartão para verificação
   (o Always Free não gera cobrança enquanto você ficar dentro dos limites).
2. **Região "home": escolha com cuidado, não dá para trocar depois.** Para o Brasil:
   *Brazil East (São Paulo)* ou *Brazil Southeast (Vinhedo)*. Os recursos Always Free só
   existem na região home.

### A2. Gerar a chave SSH (no seu PC, PowerShell ou Git Bash)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_mini_erp -C "mini-erp"
```

Guarde a chave **privada** (`oracle_mini_erp`) só no seu PC. Na Oracle você vai colar a
**pública** (`oracle_mini_erp.pub`).

### A3. Criar a máquina
Menu → **Compute → Instances → Create instance**:

| Campo | Valor |
|---|---|
| Image | **Canonical Ubuntu 24.04** (a versão *aarch64*, para ARM) |
| Shape | **Ampere → VM.Standard.A1.Flex**, **2 OCPU e 12 GB** (ou 1 OCPU / 6 GB, que já sobra) |
| Networking | VCN e sub-rede **públicas**, com **"Assign a public IPv4 address"** marcado |
| SSH keys | **Paste public key**: o conteúdo de `oracle_mini_erp.pub` |
| Boot volume | o padrão (cerca de 50 GB) basta |

**"Out of host capacity"?** É comum. Tente outro *availability domain*, menos OCPU, ou de novo
mais tarde (horários de madrugada costumam funcionar).

### A4. Liberar HTTP/HTTPS no painel
**Networking → Virtual Cloud Networks → (sua VCN) → Security Lists → Default** → *Add Ingress Rules*:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

A porta 22 (SSH) já vem liberada. **Não** abra 3000 nem 5432: só o Caddy fica exposto.

### A5. Me passe o IP público
Com o IP da instância (aparece na página dela), eu consigo fazer a Parte B daqui via SSH,
usando a chave do seu PC. Ou siga os passos abaixo você mesmo.

---

## Parte B: configurar o servidor (via SSH)

```bash
ssh -i ~/.ssh/oracle_mini_erp ubuntu@SEU_IP
```

### B1. Firewall do sistema (a armadilha da Oracle)
As imagens Ubuntu da Oracle vêm com regras de `iptables` que **rejeitam tudo menos a porta 22**,
mesmo com 80/443 liberadas no painel. Sem este passo, o site simplesmente não abre:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT
sudo netfilter-persistent save
```

### B2. Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # saia e entre de novo no SSH para valer
```

### B3. Endereço com HTTPS
O Caddy precisa de um **nome** (não de um IP) para emitir o certificado:

- **Sem gastar nada:** use o `sslip.io`, que transforma o IP num nome. Para o IP `150.230.10.20`,
  use **`150-230-10-20.sslip.io`**. Não precisa configurar nada. Se a emissão do certificado
  falhar por limite de taxa do Let's Encrypt (domínio compartilhado), use o DuckDNS
  (gratuito, com cadastro) ou um domínio próprio.
- **Domínio próprio:** crie um registro **A** apontando para o IP.

### B4. Subir o sistema

```bash
git clone https://github.com/msampaio-dev/mini-erp.git && cd mini-erp
cp deploy/.env.prod.example deploy/.env.prod
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='   # rode 2x: senha do banco e do admin
nano deploy/.env.prod                                 # SITE_ADDRESS, PUBLIC_URL, senhas, e-mail do admin
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

O primeiro build leva alguns minutos (as imagens são compiladas no próprio servidor, em ARM).
Depois confira:

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod ps
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod exec backup sh /scripts/restore-check.sh
```

Abra `https://SEU-ENDERECO`, entre com o admin do `.env.prod` e **troque a senha** em *Meu acesso*.

### B5. Backup fora da máquina (Object Storage da Oracle)
O Always Free inclui armazenamento de objetos. Crie um *bucket* e uma *Customer Secret Key*
(compatível com S3) e preencha o `deploy/.env.offsite` (ver `deploy/.env.offsite.example`).

- **Protege contra:** perda da VM ou do disco.
- **Não protege contra:** perda da conta Oracle.
- **Para dados reais:** mantenha também uma cópia em outro provedor.

---

## Cuidados específicos da Oracle

- **Instâncias ociosas podem ser recuperadas.** A Oracle pode recuperar instâncias Always Free
  com uso muito baixo por longos períodos. Um sistema em uso diário não costuma ser afetado;
  confira a política atual na documentação.
- **Sem garantia de disponibilidade.** Não há SLA no plano gratuito.
- **Atualizações de segurança:** o Ubuntu já vem com `unattended-upgrades`, que instala os
  patches de segurança sozinho.
