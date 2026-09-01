import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LiveKpiService } from './live-kpi.service';

interface RequestUser { id: string; factoryId: string | null }

/**
 * "Now" — what the plant is doing at this instant.
 *
 * Deliberately its own URL space. The split between live and historical was a
 * convention that lived in people's heads, and the numbers drifted because
 * nothing enforced it. `/live/*` takes no date range at all: there is no
 * parameter to pass one, so a caller cannot quietly turn a live page into a
 * historical one and wonder why it disagrees with the analytics beside it.
 *
 * Scope is a factory or a line. A single machine is an analytics question — a
 * live page answers "how is the plant running right now".
 */
@ApiTags('Live')
@ApiBearerAuth('JWT-auth')
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveKpiService) {}

  @Get('overview')
  @RequirePermissions('production:read')
  @ApiOperation({
    summary: 'Live plant state: machine states now, job orders running, and shift-to-date OEE',
  })
  @ApiQuery({ name: 'lineId', required: false, description: 'Omit for the whole factory' })
  overview(@CurrentUser() user: RequestUser, @Query('lineId') lineId?: string) {
    return this.live.overview(user.factoryId, { lineId });
  }
}
