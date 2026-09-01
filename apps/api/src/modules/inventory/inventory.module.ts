import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { RawMaterialsService } from './raw-materials.service';
import { StockMovementsService } from './stock-movements.service';
import { StorageTransferService } from './storage-transfer.service';
import { StorageTransferController } from './storage-transfer.controller';
import { TraceabilityModule } from '../traceability/traceability.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TraceabilityModule, NotificationsModule],
  controllers: [InventoryController, StorageTransferController],
  providers: [InventoryService, RawMaterialsService, StockMovementsService, StorageTransferService],
  exports: [InventoryService, RawMaterialsService, StockMovementsService],
})
export class InventoryModule {}
