import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserRolesSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type UpdateUserRolesInput,
  type User,
} from '@mini-erp/contracts';
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

  @Put(':id/roles')
  updateRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserRolesSchema)) input: UpdateUserRolesInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<User> {
    return this.users.updateRoles(id, input.roles, auth.user.id);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.users.resetPassword(id, input.newPassword, auth.user.id);
  }
}
