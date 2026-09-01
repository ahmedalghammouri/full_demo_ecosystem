import {
  Controller, Get, Param, Query,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery,
} from '@nestjs/swagger';
import { TraceabilityService } from './traceability.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Traceability')
@ApiBearerAuth('JWT-auth')
@Controller('traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  // ────────────────────────────────────────────────────────────
  // DASHBOARD STATS
  // ────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Traceability dashboard stats (event counts by type, 24h/7d activity)' })
  async getDashboardStats(@CurrentUser() user: RequestUser) {
    return this.traceabilityService.getDashboardStats(user.factoryId);
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Material consumption ledger (per WO/batch/lot, fed by routing-step materials on completion)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listConsumption(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.traceabilityService.listConsumption(user.factoryId, {
      search, workOrderId,
      page: parseInt(page, 10), limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // FACTORY-WIDE EVENT FEED
  // ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Paginated traceability event feed with filters' })
  @ApiQuery({ name: 'entityType', required: false, description: 'Filter by entity type (MAINT_WO, PROD_WO, BATCH, SPARE_PART, RAW_MATERIAL, MACHINE, PRODUCT)' })
  @ApiQuery({ name: 'eventType', required: false, description: 'Filter by event type (CREATED, STATUS_CHANGED, STOCK_IN, STOCK_OUT, etc.)' })
  @ApiQuery({ name: 'performedById', required: false })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in entityCode, notes' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findEvents(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType?: string,
    @Query('eventType') eventType?: string,
    @Query('performedById') performedById?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.traceabilityService.findEvents(user.factoryId, {
      entityType,
      eventType,
      performedById,
      dateFrom,
      dateTo,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // ENTITY HISTORY
  // ────────────────────────────────────────────────────────────

  @Get('entity/:entityType/:entityId')
  @ApiOperation({ summary: 'Full audit trail for a specific entity' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getEntityHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.traceabilityService.getEntityHistory(
      entityType,
      entityId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }
}
