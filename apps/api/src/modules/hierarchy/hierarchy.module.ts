import { Module } from '@nestjs/common';
import { HierarchyController } from './hierarchy.controller';
import { HierarchyService } from './hierarchy.service';
import { WorkCenterService } from './workcenter.service';

@Module({
  controllers: [HierarchyController],
  providers: [HierarchyService, WorkCenterService],
  exports: [WorkCenterService],
})
export class HierarchyModule {}
