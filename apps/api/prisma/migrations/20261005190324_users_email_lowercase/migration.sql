-- Defesa em profundidade: o contrato Zod já normaliza o e-mail,
-- mas o banco garante a regra mesmo se algum código esquecer.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
