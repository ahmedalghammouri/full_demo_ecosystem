import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TraceabilityService } from './traceability.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Production')
@ApiBearerAuth('JWT-auth')
@Controller('production/traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get('backward/:fgLotId')
  @ApiOperation({ summary: 'Backward trace: FG Lot → WO → Recipe + Material Lots' })
  traceBackward(@Param('fgLotId') fgLotId: string): Promise<any> {
    return this.traceabilityService.traceBackward(fgLotId);
  }

  @Get('forward/:materialLotId')
  @ApiOperation({ summary: 'Forward trace: Material Lot → WOs → FG Lots' })
  traceForward(@Param('materialLotId') materialLotId: string): Promise<any> {
    return this.traceabilityService.traceForward(materialLotId);
  }

  @Get('links/:entityType/:entityId')
  @ApiOperation({ summary: 'Raw traceability links for any entity' })
  getLinksForEntity(
    @Param('entityType') entityType: 'MATERIAL_LOT' | 'WORK_ORDER' | 'FINISHED_GOODS_LOT' | 'RECIPE',
    @Param('entityId') entityId: string,
  ) {
    return this.traceabilityService.getLinksForEntity(entityType, entityId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Traceability coverage stats for the factory' })
  getStats(@CurrentUser() user: RequestUser) {
    if (!user.factoryId) return { totalLinks: 0, lotsTracked: 0, wosTracked: 0 };
    return this.traceabilityService.getTraceabilityStats(user.factoryId);
  }

  @Post('links')
  @ApiOperation({ summary: 'Manually record a traceability link' })
  recordLink(
    @CurrentUser() user: RequestUser,
    @Body() dto: {
      parentType: 'MATERIAL_LOT' | 'WORK_ORDER' | 'FINISHED_GOODS_LOT' | 'RECIPE';
      parentId: string;
      childType: 'MATERIAL_LOT' | 'WORK_ORDER' | 'FINISHED_GOODS_LOT' | 'RECIPE';
      childId: string;
      linkType: 'CONSUMED_BY' | 'PRODUCED_FROM' | 'GOVERNED_BY';
      quantity?: number;
      unit?: string;
    },
  ) {
    return this.traceabilityService.recordLink({ ...dto, factoryId: user.factoryId ?? '' });
  }
}
