import { Module } from '@nestjs/common';
import { StoreController } from './store.controller.js';

@Module({
  controllers: [StoreController],
})
export class StoreModule {}
