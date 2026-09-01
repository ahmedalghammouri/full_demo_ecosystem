import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  enterpriseId: string;
  factoryId: string | null;
  role: string;
}

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'FACTORY_ADMIN', 'PLANT_MANAGER')
  async findAll(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll(user.factoryId, {
      search,
      role,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('me')
  async getMe(@CurrentUser() user: RequestUser) {
    return this.usersService.findById(user.id);
  }

  // Assignable users for job-order assignment — everyone below the caller's role
  // in their factory. Gated by production:write so Production Managers/Supervisors
  // can populate the "Assign to" picker without full user-management access.
  @Get('assignable')
  @RequirePermissions('production:write')
  async findAssignable(@CurrentUser() user: RequestUser) {
    return this.usersService.findAssignable(user.factoryId, user.role);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() body: {
      name?: string; nameAr?: string; department?: string; jobTitle?: string;
      phone?: string; language?: string; timezone?: string;
      notifyEmail?: boolean; notifyWhatsapp?: boolean; notifySMS?: boolean;
    },
  ) {
    return this.usersService.updateProfile(user.id, body);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'FACTORY_ADMIN')
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: {
      email: string;
      name: string;
      role: string;
      department?: string;
      jobTitle?: string;
      phone?: string;
      password: string;
      factoryId?: string | null;
    },
  ) {
    return this.usersService.create({
      enterpriseId: user.enterpriseId,
      factoryId: user.role === 'SUPER_ADMIN' ? (body.factoryId ?? null) : user.factoryId,
      email: body.email,
      name: body.name,
      role: body.role,
      department: body.department,
      jobTitle: body.jobTitle,
      phone: body.phone,
      password: body.password,
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; role?: string; department?: string; isActive?: boolean; factoryId?: string | null },
  ) {
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'FACTORY_ADMIN')
  async remove(@Param('id') id: string) {
    await this.usersService.deactivate(id);
    return { message: 'User deactivated' };
  }
}
