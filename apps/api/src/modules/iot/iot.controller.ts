import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { IotService, TelemetryDto } from './iot.service';
import { IndustrialDriverFactory } from './drivers/driver-factory';
import { MqttMonitorService } from './mqtt-monitor.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

class TagValueDto {
  @IsString() tagCode!: string;
  @IsString() value!: string;
  @IsOptional() @IsString() quality?: string;
}

class IngestTelemetryDto implements TelemetryDto {
  @IsString() machineId!: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsNumber() actualSpeed?: number;
  @IsOptional() @IsNumber() goodCount?: number;
  @IsOptional() @IsNumber() rejectCount?: number;
  @IsOptional() @IsNumber() runtimeDelta?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TagValueDto)
  tagValues?: TagValueDto[];
}

@ApiTags('IIoT')
@ApiBearerAuth('JWT-auth')
@Controller('iot')
export class IotController {
  constructor(
    private readonly iotService: IotService,
    private readonly driverFactory: IndustrialDriverFactory,
    private readonly mqttMonitor: MqttMonitorService,
  ) {}

  // ── MQTT live monitor (in-app MQTT client) ──────────────────
  @Get('mqtt/messages')
  @ApiOperation({ summary: 'Recent MQTT messages seen on the broker (live monitor buffer)' })
  getMqttMessages(@Query('topic') topic?: string, @Query('limit') limit = '200') {
    return this.mqttMonitor.getMessages(topic, Math.min(parseInt(limit, 10) || 200, 1000));
  }

  @Get('mqtt/topics')
  @ApiOperation({ summary: 'Distinct MQTT topics seen this session' })
  getMqttTopics() {
    return { topics: this.mqttMonitor.getTopics(), stats: this.mqttMonitor.stats() };
  }

  @Post('mqtt/publish')
  @ApiOperation({ summary: 'Publish a message to an MQTT topic (control plane / testing)' })
  publishMqtt(@Body() body: { topic: string; payload: unknown }) {
    this.mqttMonitor.publish(body.topic, body.payload);
    return { published: true, topic: body.topic };
  }

  @Post('ingest')
  @ApiOperation({
    summary: 'Ingest machine telemetry',
    description: 'Push real-time machine state, speed, counts, and tag values from PLCs/HMIs/simulators.',
  })
  async ingestTelemetry(
    @CurrentUser() user: RequestUser,
    @Body() dto: IngestTelemetryDto,
  ) {
    return this.iotService.ingestTelemetry(user.factoryId, dto);
  }

  @Get('machines/states')
  @ApiOperation({ summary: 'Get live state of all machines in the factory' })
  async getMachineStates(@CurrentUser() user: RequestUser) {
    return this.iotService.getMachineStates(user.factoryId);
  }

  @Get('devices')
  @ApiOperation({ summary: 'List IoT devices' })
  async getDevices(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('areaId') areaId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.iotService.getDevices(user.factoryId, {
      status,
      search,
      machineId,
      lineId,
      areaId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('devices/:id/status')
  @ApiOperation({ summary: 'Get device connection status and latest tag values' })
  async getDeviceStatus(@Param('id') id: string) {
    return this.iotService.getDeviceStatus(id);
  }

  @Post('devices/:id/connect')
  @ApiOperation({ summary: 'Mark device as CONNECTED' })
  async connectDevice(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.iotService.connectDevice(user.factoryId, id);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Browse tag definitions' })
  async getTags(
    @CurrentUser() user: RequestUser,
    @Query('deviceId') deviceId?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('areaId') areaId?: string,
    @Query('meterId') meterId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.iotService.getTags(user.factoryId, {
      deviceId,
      machineId,
      lineId,
      areaId,
      meterId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('tags/read')
  @ApiOperation({ summary: 'Read live tag values via industrial protocol driver' })
  async readTags(
    @Body() body: { deviceId: string; addresses: string[]; protocol: string },
  ) {
    const driver = this.driverFactory.getDriver(body.protocol as 'MQTT' | 'OPCUA' | 'MODBUS');
    const results: Record<string, unknown> = {};
    for (const addr of body.addresses) {
      results[addr] = await driver.readTag(addr);
    }
    return results;
  }

  @Get('protocols')
  @ApiOperation({ summary: 'List supported industrial protocols' })
  getSupportedProtocols() {
    return {
      protocols: this.driverFactory.getSupportedProtocols(),
      details: [
        { protocol: 'MQTT', description: 'Message Queue Telemetry Transport', port: 1883 },
        { protocol: 'OPCUA', description: 'OPC Unified Architecture', port: 4840 },
        { protocol: 'MODBUS', description: 'Modbus TCP/IP', port: 502 },
        { protocol: 'S7', description: 'Siemens S7 Protocol', port: 102 },
        { protocol: 'FINS', description: 'Omron FINS', port: 9600 },
        { protocol: 'HTTP', description: 'REST/HTTP Integration', port: 80 },
      ],
    };
  }

  // ────────────────────────────────────────────────────────────
  // DEVICE CRUD
  // ────────────────────────────────────────────────────────────

  @Get('devices/kpis')
  @ApiOperation({ summary: 'Device connection KPIs' })
  async getDeviceKPIs(@CurrentUser() user: RequestUser) {
    return this.iotService.getDeviceKPIs(user.factoryId);
  }

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new industrial device' })
  async createDevice(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.iotService.createDevice(user.factoryId, dto);
  }

  @Patch('devices/:id')
  @ApiOperation({ summary: 'Update device details' })
  async updateDevice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.iotService.updateDevice(user.factoryId, id, dto);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a device' })
  async deleteDevice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.iotService.deleteDevice(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // TAG CRUD
  // ────────────────────────────────────────────────────────────

  @Post('tags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new tag definition' })
  async createTag(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.iotService.createTag(user.factoryId, dto);
  }

  @Patch('tags/:id')
  @ApiOperation({ summary: 'Update a tag definition' })
  async updateTag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.iotService.updateTag(user.factoryId, id, dto);
  }

  @Delete('tags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a tag definition' })
  async deleteTag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.iotService.deleteTag(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // EDGE GATEWAYS
  // ────────────────────────────────────────────────────────────

  @Get('gateways')
  @ApiOperation({ summary: 'List edge gateways with online status' })
  async getGateways(@CurrentUser() user: RequestUser) {
    return this.iotService.getGateways(user.factoryId);
  }

  @Get('gateways/kpis')
  @ApiOperation({ summary: 'Edge gateway KPIs (total / online / offline)' })
  async getGatewayKPIs(@CurrentUser() user: RequestUser) {
    return this.iotService.getGatewayKPIs(user.factoryId);
  }

  @Patch('gateways/:id')
  @ApiOperation({ summary: 'Update gateway name / config' })
  async updateGateway(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { name?: string; config?: unknown; isActive?: boolean },
  ) {
    return this.iotService.updateGateway(user.factoryId, id, dto);
  }

  @Delete('gateways/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate an edge gateway' })
  async deleteGateway(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.iotService.deleteGateway(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // ENERGY READINGS
  // ────────────────────────────────────────────────────────────

  @Post('energy/readings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ingest an energy meter reading' })
  async ingestEnergyReading(
    @CurrentUser() user: RequestUser,
    @Body() dto: { meterId: string; value: number; powerKw?: number; timestamp?: string },
  ) {
    return this.iotService.ingestEnergyReading(user.factoryId, dto);
  }

  @Get('energy/timeseries')
  @ApiOperation({ summary: 'Energy readings timeseries (for chart)' })
  async getEnergyTimeseries(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('workCenterId') workCenterId?: string,
  ) {
    return this.iotService.getEnergyTimeseries(user.factoryId, { from, to, workOrderId, workCenterId });
  }

  @Get('energy/wo/:workOrderId')
  @ApiOperation({ summary: 'Energy summary for a Work Order' })
  async getEnergyWOSummary(@Param('workOrderId') workOrderId: string) {
    return this.iotService.getEnergyWOSummary(workOrderId);
  }

  @Post('energy/wo-summaries/backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recompute per-WO energy summaries for every order that has readings',
    description:
      'Repairs history: the completion listener was bound to an event nothing ' +
      'emitted, so energy_wo_summaries was never populated. Idempotent — pass ' +
      'force=true to recompute rows that already exist.',
  })
  @ApiQuery({ name: 'force', required: false })
  async backfillEnergyWOSummaries(
    @CurrentUser() user: RequestUser,
    @Query('force') force?: string,
  ) {
    return this.iotService.backfillEnergyWOSummaries(user.factoryId, force === 'true');
  }

  @Get('energy/by-workcenter')
  @ApiOperation({ summary: 'Aggregate energy by WorkCenter (plant energy map)' })
  async getEnergyByWorkCenter(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!user.factoryId) return [];
    return this.iotService.getEnergyByWorkCenter(user.factoryId, from, to);
  }
  // ────────────────────────────────────────────────────────────
  // MACHINE STATE RULES — what a state MEANS for downtime and OEE
  //
  // These were constants in the edge gateway. Which reason a stop is filed under,
  // whether it counts as planned, and whether it is charged against OEE are plant
  // decisions; a customer should not need a redeploy to change one.
  // ────────────────────────────────────────────────────────────

  @Get('state-rules')
  @RequirePermissions('iot:signals')
  @ApiOperation({ summary: 'Machine state rules for this factory' })
  @ApiQuery({ name: 'machineId', required: false, description: 'Include per-machine overrides' })
  async getStateRules(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
  ) {
    return this.iotService.listStateRules(user.factoryId, machineId);
  }

  @Post('state-rules')
  @RequirePermissions('iot:signals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or replace a machine state rule' })
  async upsertStateRule(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.iotService.upsertStateRule(user.factoryId, dto);
  }

  @Patch('state-rules/:id')
  @RequirePermissions('iot:signals')
  @ApiOperation({ summary: 'Update a machine state rule' })
  async updateStateRule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.iotService.updateStateRule(user.factoryId, id, dto);
  }

  @Delete('state-rules/:id')
  @RequirePermissions('iot:signals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a machine state rule (falls back to the factory rule)' })
  async deleteStateRule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.iotService.deleteStateRule(user.factoryId, id);
  }
}
