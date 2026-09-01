import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe, NotFoundException, Put,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { RawMaterialsService } from './raw-materials.service';
import { StockMovementsService } from './stock-movements.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Inventory')
@ApiBearerAuth('JWT-auth')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly rawMaterialsService: RawMaterialsService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // OVERVIEW
  // ────────────────────────────────────────────────────────────

  @Get('overview')
  @ApiOperation({ summary: 'Inventory overview KPIs' })
  async getOverview(@CurrentUser() user: RequestUser) {
    return this.inventoryService.getOverview(user.factoryId);
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS
  // ────────────────────────────────────────────────────────────

  @Get('spare-parts')
  @ApiOperation({ summary: 'List spare parts' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'lowStock', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findSpareParts(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.inventoryService.findSpareParts(user.factoryId, {
      search,
      category,
      lowStock: lowStock === 'true',
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('spare-parts')
  @ApiOperation({ summary: 'Create spare part' })
  async createSparePart(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? dto.factoryId;
    if (!factoryId) throw new NotFoundException('Factory context required');
    return this.inventoryService.createSparePart(factoryId, dto);
  }

  @Patch('spare-parts/:id')
  @ApiOperation({ summary: 'Update spare part' })
  async updateSparePart(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateSparePart(user.factoryId, id, dto);
  }

  @Post('spare-parts/:id/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust spare part stock level' })
  async adjustStock(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { quantity: number; type: 'ADD' | 'REMOVE' | 'SET'; reason?: string },
  ) {
    return this.inventoryService.adjustStock(user.factoryId, id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // UNIFIED STOCK ADJUSTMENT
  // ────────────────────────────────────────────────────────────

  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust on-hand quantity for any inventory entity (raw material, spare part, product, material lot, finished-goods lot). Modes: ADD | REMOVE | SET.' })
  async adjustInventory(
    @CurrentUser() user: RequestUser,
    @Body() dto: {
      entityType: 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT' | 'MATERIAL_LOT' | 'FINISHED_GOODS_LOT';
      entityId: string;
      mode: 'ADD' | 'REMOVE' | 'SET';
      quantity: number;
      reason?: string;
    },
  ) {
    return this.inventoryService.adjustInventory(user.factoryId, user.id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTS (SKUs)
  // ────────────────────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'List product SKUs with BOM' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findProducts(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.inventoryService.findProducts(user.factoryId, {
      search,
      category,
      brand,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // MATERIAL LOTS
  // ────────────────────────────────────────────────────────────

  @Get('materials')
  @ApiOperation({ summary: 'List material lots' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findMaterials(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.inventoryService.findMaterials(user.factoryId, {
      search,
      status,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('materials')
  @ApiOperation({ summary: 'Receive new material lot' })
  async createMaterialLot(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? dto.factoryId;
    if (!factoryId) throw new NotFoundException('Factory context required');
    return this.inventoryService.createMaterialLot(factoryId, dto);
  }

  @Delete('materials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a material lot' })
  async deleteMaterialLot(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteMaterialLot(user.factoryId, id);
  }

  @Delete('spare-parts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a spare part' })
  async deleteSparePart(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteSparePart(user.factoryId, id);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product (SKU)' })
  async createProduct(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.inventoryService.createProduct(user.factoryId, dto);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product (SKU)' })
  async updateProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateProduct(user.factoryId, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product (SKU)' })
  async deleteProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteProduct(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCT MASTER DATA (categories / brands / packaging-types / base-units / base-weights)
  // ────────────────────────────────────────────────────────────

  @Get('master')
  @ApiOperation({ summary: 'All product master-data lookups (category, brand, packaging, base unit, base weight)' })
  async getProductMasterData(@CurrentUser() user: RequestUser) {
    return this.inventoryService.getProductMasterData(user.factoryId);
  }

  @Post('master/:entity')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a master-data item (entity: categories|brands|packaging-types|base-units|base-weights)' })
  async createMasterItem(
    @CurrentUser() user: RequestUser,
    @Param('entity') entity: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.createMasterItem(user.factoryId, entity, dto);
  }

  @Patch('master/:entity/:id')
  @ApiOperation({ summary: 'Update a master-data item' })
  async updateMasterItem(
    @CurrentUser() user: RequestUser,
    @Param('entity') entity: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateMasterItem(user.factoryId, entity, id, dto);
  }

  @Delete('master/:entity/:id')
  @ApiOperation({ summary: 'Delete a master-data item (soft-disables when in use)' })
  async deleteMasterItem(
    @CurrentUser() user: RequestUser,
    @Param('entity') entity: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteMasterItem(user.factoryId, entity, id);
  }

  @Get('uom/convert')
  @ApiOperation({ summary: 'Convert a quantity between two units of the same category (unified UoM module)' })
  @ApiQuery({ name: 'qty', required: true })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async convertUom(
    @CurrentUser() user: RequestUser,
    @Query('qty') qty: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.inventoryService.convertUom(user.factoryId, parseFloat(qty), from, to);
  }

  // ────────────────────────────────────────────────────────────
  // RAW MATERIALS
  // ────────────────────────────────────────────────────────────

  @Get('raw-materials')
  @ApiOperation({ summary: 'List raw materials / packaging / consumables' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'lowStock', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findRawMaterials(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.rawMaterialsService.findAll(user.factoryId, {
      search,
      category,
      lowStock: lowStock === 'true',
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('raw-materials/:id')
  @ApiOperation({ summary: 'Get a raw material by ID' })
  async getRawMaterial(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rawMaterialsService.findById(user.factoryId, id);
  }

  @Get('raw-materials/:id/movements')
  @ApiOperation({ summary: 'Get raw material with full stock movement history' })
  async getRawMaterialWithMovements(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rawMaterialsService.getWithMovements(user.factoryId, id);
  }

  @Get('raw-materials/:id/lots')
  @ApiOperation({ summary: 'List material lots linked to a raw material' })
  async getRawMaterialLots(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rawMaterialsService.getLots(user.factoryId, id);
  }

  @Post('raw-materials')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a raw material master record' })
  async createRawMaterial(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.rawMaterialsService.create(user.factoryId, dto, user.id);
  }

  @Patch('raw-materials/:id')
  @ApiOperation({ summary: 'Update a raw material' })
  async updateRawMaterial(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.rawMaterialsService.update(user.factoryId, id, dto, user.id);
  }

  @Delete('raw-materials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate (soft-delete) a raw material' })
  async deleteRawMaterial(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rawMaterialsService.delete(user.factoryId, id, user.id);
  }

  @Post('raw-materials/:id/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust raw material stock level' })
  async adjustRawMaterialStock(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { quantity: number; reason: string },
  ) {
    return this.rawMaterialsService.adjustStock(
      user.factoryId,
      id,
      dto.quantity,
      dto.reason,
      user.id,
    );
  }

  // ────────────────────────────────────────────────────────────
  // STORAGE LOCATIONS
  // ────────────────────────────────────────────────────────────

  @Get('storage-locations')
  @ApiOperation({ summary: 'List storage locations' })
  @ApiQuery({ name: 'zone', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findStorageLocations(
    @CurrentUser() user: RequestUser,
    @Query('zone') zone?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.inventoryService.findStorageLocations(user.factoryId, {
      zone,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('storage-locations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a storage location' })
  async createStorageLocation(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? dto.factoryId;
    if (!factoryId) throw new NotFoundException('Factory context required');
    return this.inventoryService.createStorageLocation(factoryId, dto);
  }

  @Patch('storage-locations/:id')
  @ApiOperation({ summary: 'Update a storage location' })
  async updateStorageLocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateStorageLocation(user.factoryId, id, dto);
  }

  @Delete('storage-locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a storage location' })
  async deleteStorageLocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteStorageLocation(user.factoryId, id);
  }

  @Get('storage-locations/:id/contents')
  @ApiOperation({ summary: 'Get all items stored at a location (ISA-95 MaterialLot, RawMaterial, SparePart, SKU)' })
  async getLocationContents(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.getLocationContents(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // BOM MANAGEMENT
  // ────────────────────────────────────────────────────────────

  @Get('bom')
  @ApiOperation({ summary: 'List BOMs with items' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findBOMs(
    @CurrentUser() user: RequestUser,
    @Query('skuId') skuId?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.inventoryService.findBOMs(user.factoryId, {
      skuId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('bom/resolve-process')
  @ApiOperation({ summary: 'Find the manufacturing process a BOM would derive from (scope chain: product → list → category → base weight)' })
  @ApiQuery({ name: 'skuId', required: true })
  async resolveProcessForBom(
    @CurrentUser() user: RequestUser,
    @Query('skuId', ParseUUIDPipe) skuId: string,
  ) {
    const process = await this.inventoryService.resolveProcessForSku(user.factoryId, skuId);
    if (!process) return { found: false, process: null };
    return {
      found: true,
      process: {
        id: process.id,
        name: process.name,
        version: process.version,
        scopeType: process.scopeType,
        steps: process.routingSteps.map((s) => ({
          stepNumber: s.stepNumber,
          operationName: s.operationName,
          outUnit: s.outUnit,
          materials: s.materials.length,
        })),
        totalMaterials: process.routingSteps.reduce((n, s) => n + s.materials.length, 0),
      },
    };
  }

  @Get('bom/:id')
  @ApiOperation({ summary: 'Get BOM by ID with all items' })
  async getBOMById(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.getBOMById(id);
  }

  @Post('bom/generate-from-process')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Derive a BOM from a manufacturing process (smart linking — BOM = process summary)' })
  async generateBomFromProcess(
    @CurrentUser() user: RequestUser,
    @Body() dto: { skuId: string; processId?: string; version?: string },
  ) {
    return this.inventoryService.generateBomFromProcess(user.factoryId, user.id, dto);
  }

  @Post('bom/:id/generate-process')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a DRAFT manufacturing process from a manual BOM (guided flow inverse)' })
  async generateProcessFromBom(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.generateProcessFromBom(user.factoryId, id);
  }

  @Get('manufacturing-processes/:id/products')
  @ApiOperation({ summary: 'Canonical covered-product list of a process (resolved from its scope product ids)' })
  async getProcessProducts(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.getProcessProducts(user.factoryId, id);
  }

  @Get('processes/:id/bom-coverage')
  @ApiOperation({ summary: 'Compare process step materials against the active BOM (covered / missing / extra / qty deltas)' })
  async processBomCoverage(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.processBomCoverage(user.factoryId, id);
  }

  @Post('processes/:id/allocate-from-bom')
  @ApiOperation({ summary: 'Distribute unallocated BOM items onto routing steps (category heuristic)' })
  async allocateFromBom(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.allocateProcessMaterialsFromBom(user.factoryId, id);
  }

  @Post('bom')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create BOM for a SKU' })
  async createBOM(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.inventoryService.createBOM(user.factoryId, dto);
  }

  @Patch('bom/:id')
  @ApiOperation({ summary: 'Update BOM header (version, notes, active)' })
  async updateBOM(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateBOM(id, dto);
  }

  @Post('bom/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve BOM (sets active, deactivates other versions)' })
  async approveBOM(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.approveBOM(id, user.id);
  }

  @Post('bom/:id/items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add or update a BOM line item' })
  async upsertBOMItem(
    @Param('id', ParseUUIDPipe) bomId: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.upsertBOMItem(bomId, dto);
  }

  @Delete('bom/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a BOM (draft only)' })
  async deleteBOM(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteBOM(id, user.factoryId);
  }

  @Delete('bom/:bomId/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a BOM line item' })
  async deleteBOMItem(
    @Param('bomId', ParseUUIDPipe) bomId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.inventoryService.deleteBOMItem(bomId, itemId);
  }

  // ────────────────────────────────────────────────────────────
  // MANUFACTURING PROCESSES
  // ────────────────────────────────────────────────────────────

  @Get('manufacturing-processes')
  @ApiOperation({ summary: 'List manufacturing processes / routings' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findProcesses(
    @CurrentUser() user: RequestUser,
    @Query('skuId') skuId?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.inventoryService.findProcesses(user.factoryId, {
      skuId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('manufacturing-processes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manufacturing process with routing steps' })
  async createProcess(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? dto.factoryId;
    if (!factoryId) throw new NotFoundException('Factory context required');
    return this.inventoryService.createProcess(factoryId, dto, user.id);
  }

  @Patch('manufacturing-processes/:id')
  @ApiOperation({ summary: 'Update a manufacturing process' })
  async updateProcess(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.inventoryService.updateProcess(id, dto, user.id);
  }

  @Post('manufacturing-processes/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve process (sets active, deactivates others for same SKU)' })
  async approveProcess(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.approveProcess(id, user.id);
  }

  @Post('manufacturing-processes/:id/revert-to-draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revert an approved process back to draft' })
  async revertToDraft(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.revertToDraft(id);
  }

  @Get('manufacturing-processes/:id')
  @ApiOperation({ summary: 'Get a single manufacturing process by ID (with full step/dependency detail)' })
  async getProcess(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.findProcessById(user.factoryId, id);
  }

  @Delete('manufacturing-processes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft manufacturing process' })
  async deleteProcess(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventoryService.deleteProcess(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // STOCK MOVEMENTS
  // ────────────────────────────────────────────────────────────

  @Get('stock-movements')
  @ApiOperation({ summary: 'Universal stock movement ledger with filters' })
  @ApiQuery({ name: 'entityType', required: false, description: 'SPARE_PART | RAW_MATERIAL | PRODUCT' })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'movementType', required: false, description: 'RECEIPT | ISSUE | RETURN | ADJUSTMENT | RESERVATION | RELEASE | CONSUMPTION' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findStockMovements(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('movementType') movementType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.stockMovementsService.findMovements(user.factoryId, {
      entityType,
      entityId,
      movementType,
      dateFrom,
      dateTo,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }
}
