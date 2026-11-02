import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoreSettings } from '@mini-erp/contracts';
import type { Env } from '../../config/env.js';
import { Authenticated } from '../access/access-policy.js';

/** Dados da loja (cupom) e configuração do PDV (balança). Vêm do ambiente: mudam por loja, não por usuário. */
@Controller('store')
export class StoreController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('settings')
  @Authenticated()
  settings(): StoreSettings {
    return {
      name: this.config.get('STORE_NAME', { infer: true }),
      document: this.config.get('STORE_DOCUMENT', { infer: true }),
      address: this.config.get('STORE_ADDRESS', { infer: true }),
      scaleLabelMode: this.config.get('SCALE_LABEL_MODE', { infer: true }),
    };
  }
}
