import {
  Put,
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  ParseUUIDPipe, ParseBoolPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShiftService } from './shift.service';
import {
  CreateShiftTemplateDto, UpdateShiftTemplateDto, GenerateInstancesDto,
  ListInstancesQueryDto, StartShiftDto, CompleteShiftDto,
  GeneratePlannedDowntimeDto, ListPlannedDowntimeQueryDto, AddPlannedDowntimeDto,
} from './dto/shift.dto';

@ApiTags('Shifts')
@ApiBearerAuth('JWT-auth')
@Controller('shifts')
export class ShiftController {
  constructor(private readonly service: ShiftService) {}

  // ── Configuration summary ──────────────────────────────────────
  @Get('config')
  @ApiOperation({ summary: 'Factory shift configuration summary (shifts/day, working days, planned hours)' })
  getConfig(@CurrentUser() user: User) {
    return this.service.getConfigSummary(user.factoryId);
  }

  // ── Templates (the shift definitions) ──────────────────────────
  @Get('templates')
  @ApiOperation({ summary: 'List shift templates' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listTemplates(
    @CurrentUser() user: User,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ) {
    return this.service.listTemplates(user.factoryId, includeInactive ?? false);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a shift template' })
  getTemplate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTemplate(user.factoryId, id);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a shift template' })
  createTemplate(@CurrentUser() user: User, @Body() dto: CreateShiftTemplateDto) {
    return this.service.createTemplate(user.factoryId, dto);
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Update a shift template' })
  updateTemplate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftTemplateDto,
  ) {
    return this.service.updateTemplate(user.factoryId, id, dto);
  }

  // ── A shift's real breaks ──────────────────────────────────────
  //
  // The template used to carry `breakMinutes` and `cleaningMinutes`: two numbers
  // with no start time, already marked deprecated and read by nothing. They
  // could not express "twenty minutes at ten and forty at one", which is what a
  // shift actually has.

  @Get('templates/:id/breaks')
  @ApiOperation({ summary: "This shift's breaks, in order" })
  listBreaks(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listBreaks(user.factoryId, id);
  }

  @Put('templates/:id/breaks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Replace this shift's breaks. Events are created when a shift OCCURRENCE "
      + 'begins, so editing these never rewrites a break already booked.',
  })
  setBreaks(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { items: Array<{
      label: string; startTime: string; durationMin: number;
      sequence?: number; affectsOEE?: boolean;
    }> },
  ) {
    return this.service.setBreaks(user.factoryId, id, body.items ?? []);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete (or deactivate if it has history) a shift template' })
  deleteTemplate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteTemplate(user.factoryId, id);
  }

  // ── Instances (daily materialised shifts) ──────────────────────
  @Post('instances/generate')
  @ApiOperation({ summary: 'Generate daily shift instances from templates for a date range (idempotent)' })
  generate(@CurrentUser() user: User, @Body() dto: GenerateInstancesDto) {
    return this.service.generateInstances(user.factoryId, dto);
  }

  @Get('instances')
  @ApiOperation({ summary: 'List shift instances (paginated)' })
  listInstances(@CurrentUser() user: User, @Query() query: ListInstancesQueryDto) {
    return this.service.listInstances(user.factoryId, query);
  }

  @Get('instances/current')
  @ApiOperation({ summary: 'The shift currently in progress (or next today) — drives the live dashboard' })
  current(@CurrentUser() user: User) {
    return this.service.getCurrent(user.factoryId);
  }

  @Get('current-status')
  @ApiOperation({ summary: 'Live status of the shift in progress now (window, elapsed/remaining, progress)' })
  currentStatus(@CurrentUser() user: User) {
    return this.service.getCurrentShiftStatus(user.factoryId);
  }

  @Get('analysis')
  @ApiOperation({ summary: 'Shift data analysis — production, quality, downtime and per-machine breakdown for the current shift window' })
  analysis(@CurrentUser() user: User) {
    return this.service.getShiftAnalysis(user.factoryId);
  }

  @Post('instances/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a shift (sets IN_PROGRESS, assigns operator/supervisor)' })
  start(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartShiftDto,
  ) {
    return this.service.startShift(user.factoryId, id, dto);
  }

  @Post('instances/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a shift (records output + computes OEE from the planned window)' })
  complete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteShiftDto,
  ) {
    return this.service.completeShift(user.factoryId, id, dto);
  }

  // ── Planned downtime (break + cleaning ↔ downtime reasons) ─────
  @Get('downtime-causes')
  @ApiOperation({ summary: 'Planned downtime reason codes linked to the shift model' })
  plannedCauses(@CurrentUser() user: User) {
    return this.service.listPlannedCauses(user.factoryId);
  }

  @Post('planned-downtime/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Materialise planned downtime (break + cleaning) for shifts in a date range, per machine' })
  generatePlannedDowntime(@CurrentUser() user: User, @Body() dto: GeneratePlannedDowntimeDto) {
    return this.service.generatePlannedDowntime(user.factoryId, dto);
  }

  @Get('planned-downtime')
  @ApiOperation({ summary: 'List planned downtime events (excluded from OEE, visible in the downtime module)' })
  listPlannedDowntime(@CurrentUser() user: User, @Query() query: ListPlannedDowntimeQueryDto) {
    return this.service.listPlannedDowntime(user.factoryId, query);
  }

  @Post('planned-downtime')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Manually add planned downtime for an area / line / machine with a chosen reason' })
  addPlannedDowntime(@CurrentUser() user: User, @Body() dto: AddPlannedDowntimeDto) {
    return this.service.addPlannedDowntime(user.factoryId, dto);
  }

  @Delete('planned-downtime/:id')
  @ApiOperation({ summary: 'Delete a planned downtime event' })
  deletePlannedDowntime(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deletePlannedDowntime(user.factoryId, id);
  }
}
