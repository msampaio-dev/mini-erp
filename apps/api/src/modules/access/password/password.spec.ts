import { hashPassword, needsRehash, verifyPassword } from './password.js';

describe('password (Argon2id)', () => {
  it('gera hash no formato PHC e verifica a senha correta', async () => {
    const hash = await hashPassword('senha-super-secreta');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword(hash, 'senha-super-secreta')).resolves.toBe(true);
  });

  it('rejeita senha errada', async () => {
    const hash = await hashPassword('senha-super-secreta');

    await expect(verifyPassword(hash, 'senha-super-secretA')).resolves.toBe(false);
  });

  it('usa salt aleatório: mesma senha gera hashes diferentes', async () => {
    const [a, b] = await Promise.all([hashPassword('igual-igual'), hashPassword('igual-igual')]);

    expect(a).not.toBe(b);
  });

  it('trata hash malformado como senha inválida, sem lançar erro', async () => {
    await expect(verifyPassword('lixo', 'qualquer')).resolves.toBe(false);
    await expect(verifyPassword('$argon2i$v=19$m=1,t=1,p=1$YQ$YQ', 'qualquer')).resolves.toBe(false);
  });

  it('pede rehash quando os parâmetros do hash são mais fracos que os atuais', async () => {
    const atual = await hashPassword('senha-super-secreta');
    const fraco = atual.replace('m=19456,t=2', 'm=4096,t=1');

    expect(needsRehash(atual)).toBe(false);
    expect(needsRehash(fraco)).toBe(true);
  });
});
