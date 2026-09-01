import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Reports')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'List available report templates' })
  getAvailableReports() {
    return this.reportsService.getAvailableReports();
  }

  @Get('production')
  @ApiOperation({ summary: 'Get production report for date range' })
  async getProductionReport(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reportsService.getProductionReport(
      user.factoryId,
      new Date(from || Date.now() - 7 * 24 * 3600000),
      new Date(to || Date.now()),
    );
  }

  @Get('quality')
  @ApiOperation({ summary: 'Get quality report for date range' })
  async getQualityReport(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reportsService.getQualityReport(
      user.factoryId,
      new Date(from || Date.now() - 7 * 24 * 3600000),
      new Date(to || Date.now()),
    );
  }

  @Get('maintenance')
  @ApiOperation({ summary: 'Get maintenance report for date range' })
  async getMaintenanceReport(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reportsService.getMaintenanceReport(
      user.factoryId,
      new Date(from || Date.now() - 30 * 24 * 3600000),
      new Date(to || Date.now()),
    );
  }
}
