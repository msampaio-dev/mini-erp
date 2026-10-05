import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { createUserSchema, type CreateUserInput, type User } from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentAuth, RequirePermission, type AuthContext } from '../access-policy.js';
import { UsersService } from './users.service.js';

@Controller('users')
@RequirePermission('usuarios:gerenciar') // vale para todas as rotas deste controller
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<User[]> {
    return this.users.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput): Promise<User> {
    return this.users.create(input);
  }

  // Ações de negócio viram sub-recursos (POST .../deactivate) em vez de um PATCH genérico
  // com { active: false }: a intenção fica explícita e cada ação pode ter sua própria regra.
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.users.deactivate(id, auth.user.id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.activate(id);
  }
}
