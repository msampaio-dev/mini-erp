import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// @Global: infraestrutura transversal, disponível para todos os módulos
// sem precisar importar em cada um. Use @Global só para infra, nunca para domínio.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
