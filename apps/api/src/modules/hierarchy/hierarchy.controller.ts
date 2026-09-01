import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { HierarchyService } from './hierarchy.service';
import { WorkCenterService } from './workcenter.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Hierarchy')
@ApiBearerAuth('JWT-auth')
@Controller('hierarchy')
export class HierarchyController {
  constructor(
    private readonly hierarchyService: HierarchyService,
    private readonly workCenterService: WorkCenterService,
  ) {}

  @Get('tree')
  @ApiOperation({ summary: 'Get full ISA-95 hierarchy tree' })
  async getTree(@CurrentUser() user: RequestUser) {
    return this.hierarchyService.getHierarchyTree(user.factoryId);
  }

  @Get('factories')
  @ApiOperation({ summary: 'List factories accessible to user' })
  async getFactories(@CurrentUser() user: RequestUser) {
    return this.hierarchyService.getFactories(user.factoryId);
  }

  @Get('areas')
  @ApiOperation({ summary: 'List areas in the factory' })
  async getAreas(@CurrentUser() user: RequestUser) {
    return this.hierarchyService.getAreas(user.factoryId);
  }

  @Get('lines')
  @ApiOperation({ summary: 'List production lines with optional area filter' })
  async getLines(@CurrentUser() user: RequestUser, @Query('areaId') areaId?: string) {
    return this.hierarchyService.getLines(user.factoryId, areaId);
  }

  @Get('machines')
  @ApiOperation({ summary: 'List machines with optional filters' })
  async getMachines(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('type') type?: string,
  ) {
    return this.hierarchyService.getMachines(user.factoryId, { areaId, lineId, type });
  }

  @Post()
  @ApiOperation({ summary: 'Create a hierarchy node (AREA, PRODUCTION_LINE, MACHINE)' })
  async createNode(@CurrentUser() user: RequestUser, @Body() dto: any) {
    if (!user.factoryId) {
      const factories = await this.hierarchyService.getFactories(null);
      const factoryId = factories[0]?.id;
      if (!factoryId) throw new Error('No factory available');
      return this.hierarchyService.createNode(factoryId, dto);
    }
    return this.hierarchyService.createNode(user.factoryId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a hierarchy node' })
  async updateNode(@Param('id') id: string, @Body() dto: any) {
    return this.hierarchyService.updateNode(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a hierarchy node' })
  async deleteNode(@Param('id') id: string, @Body() body: { type: string }) {
    return this.hierarchyService.deleteNode(id, body.type);
  }

  // ── WorkCenter endpoints ─────────────────────────────────────

  @Get('workcenters/tree')
  @ApiOperation({ summary: 'Get WorkCenter hierarchy tree (PLANT > AREA > LINE > CELL)' })
  async getWorkCenterTree(@CurrentUser() user: RequestUser) {
    const factoryId = user.factoryId ?? await this.resolveFactoryId();
    return this.workCenterService.getTree(factoryId);
  }

  @Get('workcenters')
  @ApiOperation({ summary: 'Flat list of work centers with optional level filter' })
  async listWorkCenters(
    @CurrentUser() user: RequestUser,
    @Query('level') level?: string,
  ) {
    const factoryId = user.factoryId ?? await this.resolveFactoryId();
    return this.workCenterService.findAll(factoryId, level as any);
  }

  @Get('workcenters/:id/path')
  @ApiOperation({ summary: 'Get breadcrumb path for a work center' })
  async getWorkCenterPath(@Param('id') id: string) {
    return this.workCenterService.getPath(id);
  }

  @Post('workcenters')
  @ApiOperation({ summary: 'Create a work center node' })
  async createWorkCenter(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? await this.resolveFactoryId();
    return this.workCenterService.create(factoryId, dto);
  }

  @Patch('workcenters/:id')
  @ApiOperation({ summary: 'Update a work center' })
  async updateWorkCenter(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    const factoryId = user.factoryId ?? await this.resolveFactoryId();
    return this.workCenterService.update(factoryId, id, dto);
  }

  @Delete('workcenters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a work center' })
  async deleteWorkCenter(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const factoryId = user.factoryId ?? await this.resolveFactoryId();
    return this.workCenterService.delete(factoryId, id);
  }

  private async resolveFactoryId(): Promise<string> {
    const factories = await this.hierarchyService.getFactories(null);
    const id = factories[0]?.id;
    if (!id) throw new Error('No factory available');
    return id;
  }
}
