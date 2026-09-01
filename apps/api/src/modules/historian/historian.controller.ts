import { Controller, Get, Post, Query, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { HistorianService } from './historian.service';
import { PrismaService } from '../../database/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';

interface RequestUser { id: string; factoryId: string | null }

@ApiTags('Historian')
@ApiBearerAuth('JWT-auth')
@Controller('historian')
export class HistorianController {
  constructor(
    private readonly historian: HistorianService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Historian (InfluxDB) availability' })
  health() {
    return { enabled: this.historian.isEnabled() };
  }

  @Get('oee-trend')
  @ApiOperation({ summary: 'OEE / availability time-series for a machine (classic + time-based)' })
  @ApiQuery({ name: 'machineId', required: true })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'everyMin', required: false, type: Number })
  oeeTrend(
    @Query('machineId') machineId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('everyMin') everyMin?: string,
  ) {
    const toIso = to ?? new Date().toISOString();
    const fromIso = from ?? new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
    return this.historian.getOeeTrend(machineId, fromIso, toIso, everyMin ? parseInt(everyMin, 10) : 30);
  }

  @Get('production-trend')
  @ApiOperation({ summary: 'Production (good/rejected) time-series for a machine' })
  @ApiQuery({ name: 'machineId', required: true })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'everyMin', required: false, type: Number })
  productionTrend(
    @Query('machineId') machineId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('everyMin') everyMin?: string,
  ) {
    const toIso = to ?? new Date().toISOString();
    const fromIso = from ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    return this.historian.getProductionTrend(machineId, fromIso, toIso, everyMin ? parseInt(everyMin, 10) : 30);
  }

  @Get('tag-trend')
  @ApiOperation({ summary: 'Time-series history for a single tag (historian "tag" measurement)' })
  @ApiQuery({ name: 'tagCode', required: true })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'everyMin', required: false, type: Number, description: '0/omit = raw samples' })
  tagTrend(
    @CurrentUser() user: RequestUser,
    @Query('tagCode') tagCode: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('everyMin') everyMin?: string,
  ) {
    const toIso = to ?? new Date().toISOString();
    const fromIso = from ?? new Date(Date.now() - 8 * 3600_000).toISOString();
    return this.historian.getTagTrend(user.factoryId, tagCode, fromIso, toIso, everyMin ? parseInt(everyMin, 10) : 0);
  }

  @Post('backfill')
  @ApiOperation({ summary: 'Generate SYNTHETIC historian series into InfluxDB (demo only — requires confirm:true)' })
  backfill(@Body() body: { days?: number; stepMin?: number; confirm?: boolean }) {
    // Synthetic/fabricated data — guarded so dashboards show only real data by
    // default. Caller must explicitly opt in with confirm: true.
    if (body?.confirm !== true) {
      throw new BadRequestException('Synthetic backfill is disabled. Pass { "confirm": true } to generate demo data.');
    }
    return this.historian.backfill(body?.days ?? 14, body?.stepMin ?? 30);
  }

  @Post('sample')
  @ApiOperation({ summary: 'Force an immediate sample of all active job orders' })
  sample() {
    return this.historian.sampleActiveJobOrders().then((n) => ({ sampled: n }));
  }
}
