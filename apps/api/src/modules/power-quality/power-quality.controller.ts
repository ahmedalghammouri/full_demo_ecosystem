import { Controller, Get, Param, Query, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PowerQualityService } from './power-quality.service';
import { PowerFactorService } from './power-factor.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

/**
 * Power quality.
 *
 * Every route is scoped to the caller's factory. A SUPER_ADMIN with no factory
 * of their own must name one explicitly: the alternative is silently answering
 * for whichever site happens to sort first, which is how a number ends up on a
 * screen belonging to a plant nobody was looking at.
 */
function scopeOf(user: RequestUser, factoryId?: string): string {
  const id = factoryId ?? user.factoryId;
  if (!id) {
    throw new ForbiddenException(
      'No factory in scope. Select a factory, or pass ?factoryId= when signed in at enterprise level.',
    );
  }
  return id;
}

@ApiTags('Power Quality')
@ApiBearerAuth()
@Controller('power-quality')
export class PowerQualityController {
  constructor(
    private readonly svc: PowerQualityService,
    private readonly pf: PowerFactorService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Event counts by type, severity and ITIC zone over a window' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiQuery({ name: 'factoryId', required: false })
  summary(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Query('factoryId') factoryId?: string) {
    return this.svc.summary(scopeOf(user, factoryId), days ? Number(days) : 30);
  }

  @Get('events')
  @ApiOperation({ summary: 'Voltage events, newest first' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'type', required: false, example: 'SAG' })
  @ApiQuery({ name: 'severity', required: false, example: 'CRITICAL' })
  @ApiQuery({ name: 'meterId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  events(
    @CurrentUser() user: RequestUser,
    @Query('days') days?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('meterId') meterId?: string,
    @Query('limit') limit?: string,
    @Query('factoryId') factoryId?: string,
  ) {
    return this.svc.events(scopeOf(user, factoryId), {
      days: days ? Number(days) : undefined,
      type, severity, meterId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('itic')
  @ApiOperation({ summary: 'Measured points for the ITIC/CBEMA ride-through plot' })
  @ApiQuery({ name: 'days', required: false, example: 90 })
  @ApiQuery({ name: 'factoryId', required: false })
  itic(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Query('factoryId') factoryId?: string) {
    return this.svc.iticScatter(scopeOf(user, factoryId), days ? Number(days) : 90);
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Events per day by type' })
  @ApiQuery({ name: 'days', required: false, example: 60 })
  @ApiQuery({ name: 'factoryId', required: false })
  timeline(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Query('factoryId') factoryId?: string) {
    return this.svc.timeline(scopeOf(user, factoryId), days ? Number(days) : 60);
  }

  @Get('harmonics/ranking')
  @ApiOperation({ summary: 'Meters ranked by current distortion' })
  @ApiQuery({ name: 'factoryId', required: false })
  ranking(@CurrentUser() user: RequestUser, @Query('factoryId') factoryId?: string) {
    return this.svc.harmonicRanking(scopeOf(user, factoryId));
  }

  @Get('harmonics/:meterId')
  @ApiOperation({ summary: 'Latest spectrum per phase for one meter, with EN 50160 and IEEE 519 limits' })
  @ApiQuery({ name: 'factoryId', required: false })
  harmonics(
    @CurrentUser() user: RequestUser,
    @Param('meterId', ParseUUIDPipe) meterId: string,
    @Query('factoryId') factoryId?: string,
  ) {
    return this.svc.harmonics(scopeOf(user, factoryId), meterId);
  }

  @Get('power-factor/overview')
  @ApiOperation({ summary: 'Power factor per board, its tariff exposure, and the capacitor banks' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiQuery({ name: 'factoryId', required: false })
  pfOverview(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Query('factoryId') factoryId?: string) {
    return this.pf.overview(scopeOf(user, factoryId), days ? Number(days) : 30);
  }

  @Get('power-factor/sizing')
  @ApiOperation({ summary: 'Compensation needed to reach a target power factor, with payback' })
  @ApiQuery({ name: 'target', required: false, example: 0.98 })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'factoryId', required: false })
  pfSizing(
    @CurrentUser() user: RequestUser,
    @Query('target') target?: string,
    @Query('days') days?: string,
    @Query('factoryId') factoryId?: string,
  ) {
    return this.pf.sizing(scopeOf(user, factoryId), target ? Number(target) : 0.98, days ? Number(days) : 30);
  }

  @Get('compliance')
  @ApiOperation({ summary: 'Weekly EN 50160 assessments' })
  @ApiQuery({ name: 'weeks', required: false, example: 12 })
  @ApiQuery({ name: 'factoryId', required: false })
  compliance(@CurrentUser() user: RequestUser, @Query('weeks') weeks?: string, @Query('factoryId') factoryId?: string) {
    return this.svc.compliance(scopeOf(user, factoryId), weeks ? Number(weeks) : 12);
  }
}
