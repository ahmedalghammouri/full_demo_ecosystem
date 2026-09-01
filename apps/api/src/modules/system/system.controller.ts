import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { SystemService } from './system.service';
import { ResetSystemDto } from './dto/reset.dto';

interface RequestUser {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
  factoryId?: string | null;
}

@ApiTags('System')
@ApiBearerAuth('JWT-auth')
@Controller('system')
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly ownerGuard: SystemOwnerGuard,
  ) {}

  /**
   * Lightweight probe used by the UI to decide whether to render the Danger
   * Zone. Authenticated for everyone, but only reveals owner status — never
   * 403s, so non-owners simply don't see the section.
   */
  @Get('owner-check')
  @ApiOperation({ summary: 'Whether the current user is the designated system owner' })
  ownerCheck(@CurrentUser() user: RequestUser) {
    return {
      isOwner: this.ownerGuard.isOwner(user),
      ownerEmail: this.ownerGuard.getOwnerEmail(),
      email: user.email,
      role: user.role,
    };
  }

  @Get('status')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Resettable-data snapshot (owner only)' })
  status() {
    return this.systemService.getStatus();
  }

  @Get('planned-downtime-preview')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({
    summary: 'How many planned downtime records fall in a window',
    description:
      'Counts without deleting, using the same overlap rule the reset uses — so the number the '
      + 'operator confirms is the number that goes. Behind the owner guard like the reset itself: '
      + 'it reveals the shape of the data the reset would destroy.',
  })
  @ApiQuery({ name: 'from', required: true, description: 'ISO instant' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO instant' })
  previewPlannedDowntime(@Query('from') from?: string, @Query('to') to?: string) {
    return this.systemService.previewPlannedDowntime(from, to);
  }

  @Post('reset')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Destructive reset of production data and/or historian (owner only)' })
  reset(@CurrentUser() user: RequestUser, @Body() dto: ResetSystemDto, @Req() req: any) {
    return this.systemService.reset(
      user,
      dto,
      { ip: req?.ip, userAgent: req?.headers?.['user-agent'] },
    );
  }

  @Post('historian/pause')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Pause/resume historian writes (owner only)' })
  setHistorianPaused(@Body() body: { paused?: boolean }) {
    return this.systemService.setHistorianPaused(!!body?.paused);
  }
  // ────────────────────────────────────────────────────────────
  // DISPLAY UNIT — presentation only, never affects a calculation
  // ────────────────────────────────────────────────────────────

  @Get('display-unit')
  @ApiOperation({
    summary: 'The packaging unit quantities are presented in',
    description:
      'Quantities are STORED and calculated in PIECES — the only unit in which output from '
      + 'different routing steps can be added. This setting decides which rung of the packaging '
      + 'ladder the user reads totals on, and cannot change any computed value.',
  })
  getDisplayUnit(@CurrentUser() user: RequestUser) {
    return this.systemService.getDisplayUnit(user.factoryId ?? null);
  }

  @Patch('display-unit')
  @ApiOperation({ summary: 'Set the factory display unit (PIECE | INNER | CARTON | PALLET)' })
  setDisplayUnit(@CurrentUser() user: RequestUser, @Body() body: { displayUnit: string }) {
    return this.systemService.setDisplayUnit(user.factoryId ?? null, body?.displayUnit);
  }

  // ────────────────────────────────────────────────────────────
  // PLANNED-STOP MATERIALISATION
  // ────────────────────────────────────────────────────────────

  @Get('planned-stop-materialisation')
  @ApiOperation({
    summary: 'Whether the shift schedule is written into machine state history',
    description:
      'When on, planned-stop TEMPLATES author machine_state_records hourly, so the timeline and '
      + 'the OEE arithmetic agree inside a scheduled window instead of disagreeing. Right for a '
      + 'plant whose breaks repeat on a rule; wrong for one that plans day by day and books dated '
      + 'downtime events instead. Off by default.',
  })
  getPlannedStopMaterialisation(@CurrentUser() user: RequestUser) {
    return this.systemService.getPlannedStopMaterialisation(user.factoryId ?? null);
  }

  @Patch('planned-stop-materialisation')
  @ApiOperation({
    summary: 'Turn schedule materialisation on or off',
    description:
      'Switching off stops the hourly writer and LEAVES the records it already wrote — removing '
      + 'them is a separate, deliberate act, not something a toggle does on your behalf.',
  })
  setPlannedStopMaterialisation(
    @CurrentUser() user: RequestUser,
    @Body() body: { enabled?: boolean },
  ) {
    return this.systemService.setPlannedStopMaterialisation(user.factoryId ?? null, !!body?.enabled);
  }
}
