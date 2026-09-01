-- CreateEnum
CREATE TYPE "AreaType" AS ENUM ('MAKING', 'PACKING', 'FILLING', 'UTILITY', 'WAREHOUSE', 'LABORATORY', 'OFFICE');

-- CreateEnum
CREATE TYPE "OeeMethod" AS ENUM ('ROLLUP', 'BOTTLENECK');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('PACKING', 'FILLING', 'MAKING', 'BLOW_MOLDING', 'BLOW_FILM', 'AEROSOL', 'CUTTING_SEALING', 'UTILITY');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('MACHINE', 'PRODUCTION_LINE', 'CONVEYOR', 'ROBOT', 'PALLETIZER', 'CHECKWEIGHER', 'FILLING_MACHINE', 'CARTONING_MACHINE', 'WRAPPING_MACHINE', 'BLOW_MOLDING', 'BLOW_FILM', 'COMPRESSOR', 'BOILER', 'TRANSFORMER', 'CHILLER', 'ENERGY_METER', 'PUMP', 'MIXER', 'REACTOR', 'HMI', 'GATEWAY', 'SENSOR');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MachineState" AS ENUM ('RUNNING', 'IDLE', 'PLANNED_STOP', 'BREAKDOWN', 'SETUP', 'CHANGEOVER', 'STARTUP', 'STARVED', 'BLOCKED', 'OFFLINE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ChangeRequestType" AS ENUM ('BOM_CHANGE', 'RECIPE_CHANGE', 'PROCESS_CHANGE', 'DESIGN_CHANGE');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED');

-- CreateEnum
CREATE TYPE "UomCategory" AS ENUM ('WEIGHT', 'VOLUME', 'COUNT', 'PACKAGING', 'LENGTH', 'AREA', 'TIME');

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionEventType" AS ENUM ('WO_STARTED', 'WO_COMPLETED', 'WO_PAUSED', 'COUNT_UPDATE', 'SCRAP_RECORDED', 'CHANGEOVER_START', 'CHANGEOVER_END', 'SHIFT_START', 'SHIFT_END', 'DOWNTIME_START', 'DOWNTIME_END', 'SPEED_CHANGE', 'SKU_CHANGE');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'RELEASED', 'REJECTED', 'ON_HOLD', 'QUARANTINE', 'DEPLETED');

-- CreateEnum
CREATE TYPE "StopRecurrence" AS ENUM ('ONCE', 'PER_SHIFT', 'PER_RESTART');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DowntimeCategory" AS ENUM ('MECHANICAL', 'ELECTRICAL', 'PROCESS', 'MATERIAL', 'OPERATOR', 'CHANGEOVER', 'UTILITY', 'QUALITY', 'PLANNED_MAINTENANCE', 'PLANNED_CLEANING', 'PLANNED_BREAK', 'STARTUP', 'EXTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DowntimeReasonCode" AS ENUM ('PLANNED_MAINTENANCE', 'CHANGEOVER', 'UNPLANNED_BREAKDOWN', 'MICRO_STOP', 'STARVED', 'BLOCKED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('INCOMING', 'IN_PROCESS', 'FINAL', 'PATROL', 'AUDIT');

-- CreateEnum
CREATE TYPE "InspectionResult2" AS ENUM ('PENDING', 'PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "NCRStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CAPA_PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CAPAType" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "CAPAStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PMType" AS ENUM ('TIME_BASED', 'RUNTIME_BASED', 'CONDITION_BASED', 'CALENDAR_BASED');

-- CreateEnum
CREATE TYPE "PMTaskStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MaintType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'PREDICTIVE', 'INSPECTION', 'LUBRICATION');

-- CreateEnum
CREATE TYPE "MaintStatus" AS ENUM ('OPEN', 'AWAITING_PARTS', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpareIssueStatus" AS ENUM ('PENDING', 'ISSUED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnergyType" AS ENUM ('ELECTRICAL', 'NATURAL_GAS', 'COMPRESSED_AIR', 'WATER', 'STEAM', 'CHILLED_WATER');

-- CreateEnum
CREATE TYPE "EnergyPeriod" AS ENUM ('HOURLY', 'SHIFT', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CounterRole" AS ENUM ('TOTAL', 'GOOD', 'BAD', 'NONE');

-- CreateEnum
CREATE TYPE "TagDataType" AS ENUM ('BOOL', 'INT', 'FLOAT', 'STRING', 'TIMESTAMP');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('STATUS', 'COUNTER', 'MEASUREMENT', 'SETPOINT', 'ALARM', 'EVENT', 'ENERGY');

-- CreateEnum
CREATE TYPE "TagQuality" AS ENUM ('GOOD', 'BAD', 'UNCERTAIN', 'NOT_CONNECTED');

-- CreateEnum
CREATE TYPE "AlarmSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_MANAGER', 'PRODUCTION_SUPERVISOR', 'QUALITY_MANAGER', 'QUALITY_ENGINEER', 'MAINTENANCE_MANAGER', 'MAINTENANCE_TECHNICIAN', 'ENERGY_MANAGER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ALARM', 'DOWNTIME', 'PRODUCTION', 'QUALITY', 'MAINTENANCE', 'ENERGY', 'SYSTEM', 'INFO');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ALARM', 'PRODUCTION', 'QUALITY', 'MAINTENANCE', 'DOWNTIME', 'ENERGY', 'INVENTORY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BomSource" AS ENUM ('MANUAL', 'DERIVED_FROM_PROCESS', 'DRAFT_FOR_PROCESS');

-- CreateEnum
CREATE TYPE "StockEntityType" AS ENUM ('SPARE_PART', 'RAW_MATERIAL', 'PRODUCT');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'CONSUMPTION', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TraceEntityType" AS ENUM ('MATERIAL_LOT', 'WORK_ORDER', 'FINISHED_GOODS_LOT', 'RECIPE');

-- CreateEnum
CREATE TYPE "TraceLinkType" AS ENUM ('CONSUMED_BY', 'PRODUCED_FROM', 'GOVERNED_BY');

-- CreateEnum
CREATE TYPE "StorageZone" AS ENUM ('RAW_MATERIAL', 'FINISHED_GOODS', 'SPARE_PARTS', 'QUARANTINE', 'PRODUCTION', 'DISPATCH');

-- CreateEnum
CREATE TYPE "MaterialAvailability" AS ENUM ('OK', 'AWAITING_MATERIALS', 'SCHEDULED_FOR_DELIVERY');

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessScope" AS ENUM ('PRODUCT', 'CATEGORY', 'BASE_WEIGHT', 'PRODUCT_LIST');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkCenterLevel" AS ENUM ('PLANT', 'AREA', 'LINE', 'CELL');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'START_TO_FINISH', 'FINISH_TO_FINISH');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "JobOrderStatus" AS ENUM ('SCHEDULED', 'READY', 'EXECUTING', 'PAUSED', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScrapCategory" AS ENUM ('QUALITY', 'SETUP', 'DAMAGE', 'OVERRUN', 'MATERIAL', 'MACHINE', 'OPERATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "DashboardSource" AS ENUM ('Industry360_NATIVE', 'GRAFANA', 'REPORT', 'EXTERNAL', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "DashboardType" AS ENUM ('OPERATIONAL', 'KPI', 'ANALYTICS', 'REPORT', 'EXECUTIVE', 'ENERGY', 'QUALITY', 'MAINTENANCE', 'PRODUCTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DashboardVisibility" AS ENUM ('PRIVATE', 'FACTORY', 'ENTERPRISE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "DashboardPermissionLevel" AS ENUM ('VIEW', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "PlannedStopScope" AS ENUM ('FACTORY', 'LINE', 'MACHINE');

-- CreateEnum
CREATE TYPE "WorkOrderStopTrigger" AS ENUM ('PRODUCT_CHANGE', 'ORDER_CHANGE', 'ALWAYS');

-- CreateTable
CREATE TABLE "enterprises" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "industry" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "language" TEXT NOT NULL DEFAULT 'en',
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "color" TEXT NOT NULL DEFAULT '#00C8FF',
    "glowColor" TEXT NOT NULL DEFAULT 'rgba(0,200,255,0.3)',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "displayUnit" TEXT NOT NULL DEFAULT 'INNER',
    "plannedStopMaterialisation" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "AreaType" NOT NULL DEFAULT 'PACKING',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "LineType" NOT NULL DEFAULT 'PACKING',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "oeeMethod" "OeeMethod" NOT NULL DEFAULT 'ROLLUP',
    "bottleneckMachineId" TEXT,
    "outfeedMachineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "areaId" TEXT,
    "lineId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "machineType" "MachineType" NOT NULL DEFAULT 'MACHINE',
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "installDate" TIMESTAMP(3),
    "warrantyExpiry" TIMESTAMP(3),
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "designCapacity" DOUBLE PRECISION,
    "downtimeThreshold" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_modules" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_current_status" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "state" "MachineState" NOT NULL DEFAULT 'OFFLINE',
    "currentSKUId" TEXT,
    "currentWOId" TEXT,
    "oee" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "actualSpeed" DOUBLE PRECISION,
    "targetSpeed" DOUBLE PRECISION,
    "goodCount" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "downtimeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runtimeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_current_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_cycle_times" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "cycleTimeSeconds" DOUBLE PRECISION NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT 'UNIT',
    "maxSpeed" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'PLANT_DATA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_cycle_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ChangeRequestType" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "skuId" TEXT,
    "processId" TEXT,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reason" TEXT,
    "targetDate" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_brands" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_units" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_weights" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "category" "UomCategory" NOT NULL,
    "baseUnitCode" TEXT,
    "conversionFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "decimals" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "familyId" TEXT,
    "itemNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "shortName" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "categoryId" TEXT,
    "brandId" TEXT,
    "packagingTypeId" TEXT,
    "baseUnitId" TEXT,
    "baseWeightId" TEXT,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT NOT NULL DEFAULT 'kg',
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "dimensionUnit" TEXT NOT NULL DEFAULT 'cm',
    "packagingType" TEXT,
    "unitsPerInner" INTEGER NOT NULL DEFAULT 1,
    "innersPerCarton" INTEGER NOT NULL DEFAULT 1,
    "cartonsPerPallet" INTEGER NOT NULL DEFAULT 1,
    "baseUnit" TEXT NOT NULL DEFAULT 'EA',
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storageLocationId" TEXT,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_components" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RAW',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "sapOrderNumber" TEXT,
    "skuId" TEXT,
    "targetQty" INTEGER NOT NULL,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'CARTON',
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "oee" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "customer" TEXT,
    "notes" TEXT,
    "sapSync" BOOLEAN NOT NULL DEFAULT false,
    "sapSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reschedule_requests" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AUTO_GENERATE',
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "proposedStart" TIMESTAMP(3) NOT NULL,
    "proposedEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "workContentMins" INTEGER,
    "plannedStoppageMins" INTEGER,
    "details" JSONB,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "productionOrderId" TEXT,
    "lineId" TEXT,
    "skuId" TEXT,
    "shiftInstanceId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "autoStart" BOOLEAN NOT NULL DEFAULT false,
    "plannedQty" INTEGER NOT NULL,
    "actualQty" INTEGER NOT NULL DEFAULT 0,
    "goodQty" INTEGER NOT NULL DEFAULT 0,
    "scrapQty" INTEGER NOT NULL DEFAULT 0,
    "reworkQty" INTEGER NOT NULL DEFAULT 0,
    "qtyUnit" TEXT NOT NULL DEFAULT 'PIECE',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "oee" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "downtimeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedCycleTime" DOUBLE PRECISION,
    "recipeId" TEXT,
    "recipeVersion" TEXT,
    "materialStatus" "MaterialAvailability" NOT NULL DEFAULT 'OK',
    "materialReadyDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "startedById" TEXT,
    "completedById" TEXT,
    "operatorId" TEXT,
    "supervisorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_events" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "machineId" TEXT,
    "shiftId" TEXT,
    "eventType" "ProductionEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DOUBLE PRECISION,
    "skuId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "production_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_records" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "workOrderIds" JSONB,
    "skuId" TEXT,
    "batchNumber" TEXT NOT NULL,
    "lotNumber" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "quantity" INTEGER NOT NULL,
    "quantitySource" TEXT NOT NULL DEFAULT 'MANUAL',
    "goodQuantity" INTEGER NOT NULL DEFAULT 0,
    "scrapQuantity" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'CARTON',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "releaseDate" TIMESTAMP(3),
    "releasedById" TEXT,
    "electronicRecord" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_lots" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "supplierLot" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remainingQty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitId" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "storageLocation" TEXT,
    "storageLocationId" TEXT,
    "binNumber" TEXT,
    "notes" TEXT,
    "materialRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_consumptions" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "batchRecordId" TEXT,
    "materialLotId" TEXT,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "quantityPlanned" DOUBLE PRECISION NOT NULL,
    "quantityActual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedById" TEXT,
    "jobOrderId" TEXT,

    CONSTRAINT "material_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genealogy_links" (
    "id" TEXT NOT NULL,
    "parentBatchId" TEXT NOT NULL,
    "childBatchId" TEXT NOT NULL,
    "materialCode" TEXT,
    "quantity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genealogy_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "plannedProductionHours" DOUBLE PRECISION NOT NULL,
    "shiftDurationHours" DOUBLE PRECISION NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "cleaningMinutes" INTEGER NOT NULL DEFAULT 0,
    "days" JSONB NOT NULL,
    "targetQtyPerShift" INTEGER,
    "targetUnit" TEXT NOT NULL DEFAULT 'CARTON',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduleRuleId" TEXT,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_stops" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "recurrence" "StopRecurrence" NOT NULL DEFAULT 'ONCE',
    "affectsOEE" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_breaks" (
    "id" TEXT NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "affectsOEE" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_instances" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,
    "lineId" TEXT,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "targetQty" INTEGER,
    "actualQty" INTEGER NOT NULL DEFAULT 0,
    "goodQty" INTEGER NOT NULL DEFAULT 0,
    "scrapQty" INTEGER NOT NULL DEFAULT 0,
    "oee" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "downtimeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedDowntime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatorId" TEXT,
    "supervisorId" TEXT,
    "handoverNotes" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_state_records" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "shiftInstanceId" TEXT,
    "workOrderId" TEXT,
    "skuId" TEXT,
    "state" "MachineState" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationMinutes" DOUBLE PRECISION,
    "isPlannedStop" BOOLEAN NOT NULL DEFAULT false,
    "downtimeCauseId" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT "machine_state_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downtime_causes" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "category" "DowntimeCategory" NOT NULL,
    "isPlanned" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" INTEGER NOT NULL DEFAULT 3,
    "parentId" TEXT,

    CONSTRAINT "downtime_causes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downtime_events" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "workCenterId" TEXT,
    "workOrderId" TEXT,
    "jobOrderId" TEXT,
    "shiftInstanceId" TEXT,
    "causeId" TEXT,
    "operatorId" TEXT,
    "reason" TEXT,
    "category" "DowntimeCategory" NOT NULL,
    "reasonCode" "DowntimeReasonCode" NOT NULL DEFAULT 'UNPLANNED_BREAKDOWN',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationMinutes" DOUBLE PRECISION,
    "affectsOEE" BOOLEAN NOT NULL DEFAULT true,
    "isPlanned" BOOLEAN NOT NULL DEFAULT false,
    "reportedById" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "maintenanceWOId" TEXT,
    "schedulingImpactMins" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "downtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oee_records" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "shiftInstanceId" TEXT,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "shiftCode" TEXT,
    "skuId" TEXT,
    "plannedProductionMin" DOUBLE PRECISION NOT NULL,
    "actualProductionMin" DOUBLE PRECISION NOT NULL,
    "uptimeMin" DOUBLE PRECISION NOT NULL,
    "downtimeMin" DOUBLE PRECISION NOT NULL,
    "plannedDowntimeMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalOutput" INTEGER NOT NULL,
    "goodOutput" INTEGER NOT NULL,
    "scrapOutput" INTEGER NOT NULL DEFAULT 0,
    "idealCycleTime" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION NOT NULL,
    "performance" DOUBLE PRECISION NOT NULL,
    "quality" DOUBLE PRECISION NOT NULL,
    "oee" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oee_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_runtime_hours" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "dailyHours" DOUBLE PRECISION NOT NULL,
    "cumulativeHours" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CALCULATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_runtime_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_plans" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "skuId" TEXT,
    "machineId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'IN_PROCESS',
    "samplingFrequency" TEXT,
    "samplingQty" INTEGER NOT NULL DEFAULT 1,
    "version" TEXT NOT NULL DEFAULT '1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_parameters" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "nominalValue" DOUBLE PRECISION,
    "ucl" DOUBLE PRECISION,
    "lcl" DOUBLE PRECISION,
    "usl" DOUBLE PRECISION,
    "lsl" DOUBLE PRECISION,
    "checkMethod" TEXT,
    "isKPI" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quality_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_results" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "planId" TEXT,
    "workOrderId" TEXT,
    "batchRecordId" TEXT,
    "machineId" TEXT,
    "inspectionNumber" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "result" "InspectionResult2" NOT NULL DEFAULT 'PENDING',
    "totalQty" INTEGER NOT NULL,
    "passQty" INTEGER NOT NULL DEFAULT 0,
    "failQty" INTEGER NOT NULL DEFAULT 0,
    "qtyUnit" TEXT NOT NULL DEFAULT 'PIECE',
    "measurements" JSONB,
    "checklistData" JSONB,
    "attachments" JSONB,
    "inspectorId" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncrs" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "ncrNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MAJOR',
    "status" "NCRStatus" NOT NULL DEFAULT 'OPEN',
    "skuId" TEXT,
    "batchRecordId" TEXT,
    "machineId" TEXT,
    "defectCategory" TEXT NOT NULL,
    "defectCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "disposition" TEXT,
    "detectedById" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capas" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "capaNumber" TEXT NOT NULL,
    "ncrId" TEXT,
    "type" "CAPAType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CAPAStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "effectiveness" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capa_actions" (
    "id" TEXT NOT NULL,
    "capaId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capa_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spc_measurements" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "skuId" TEXT,
    "parameterName" TEXT NOT NULL,
    "parameterUnit" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "subgroupNumber" INTEGER,
    "workOrderId" TEXT,
    "shiftInstanceId" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measuredById" TEXT,
    "isOutOfControl" BOOLEAN NOT NULL DEFAULT false,
    "controlViolation" TEXT,
    "ucl" DOUBLE PRECISION,
    "lcl" DOUBLE PRECISION,
    "cl" DOUBLE PRECISION,
    "usl" DOUBLE PRECISION,
    "lsl" DOUBLE PRECISION,

    CONSTRAINT "spc_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_modes" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "DowntimeCategory" NOT NULL DEFAULT 'MECHANICAL',
    "causeDescription" TEXT,
    "effectDescription" TEXT,
    "severityScore" INTEGER NOT NULL DEFAULT 1,
    "occurrenceScore" INTEGER NOT NULL DEFAULT 1,
    "detectionScore" INTEGER NOT NULL DEFAULT 1,
    "rpn" INTEGER NOT NULL DEFAULT 1,
    "recommendedAction" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failure_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_wo_failure_modes" (
    "woId" TEXT NOT NULL,
    "failureModeId" TEXT NOT NULL,

    CONSTRAINT "maintenance_wo_failure_modes_pkey" PRIMARY KEY ("woId","failureModeId")
);

-- CreateTable
CREATE TABLE "pm_plans" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PMType" NOT NULL,
    "description" TEXT,
    "frequencyDays" INTEGER,
    "runtimeHours" DOUBLE PRECISION,
    "estimatedHours" DOUBLE PRECISION,
    "instructions" TEXT,
    "checklistTemplate" JSONB,
    "lastExecutedAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_plan_spare_parts" (
    "id" TEXT NOT NULL,
    "pmPlanId" TEXT NOT NULL,
    "sparePartId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',

    CONSTRAINT "pm_plan_spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_tasks" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "PMTaskStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assignedToId" TEXT,
    "actualHours" DOUBLE PRECISION,
    "notes" TEXT,
    "sparesUsed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_wos" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "woNumber" TEXT NOT NULL,
    "type" "MaintType" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "MaintStatus" NOT NULL DEFAULT 'OPEN',
    "machineId" TEXT NOT NULL,
    "failureModeId" TEXT,
    "triggeredByDowntimeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "actualHours" DOUBLE PRECISION,
    "laborCost" DOUBLE PRECISION,
    "partsCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "assignedToId" TEXT,
    "requestedById" TEXT,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "runtimeHoursAtService" DOUBLE PRECISION,
    "checklistData" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "productionWOId" TEXT,

    CONSTRAINT "maintenance_wos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_parts" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "supplier" TEXT,
    "unitCost" DOUBLE PRECISION,
    "stockQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStockQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxStockQty" DOUBLE PRECISION,
    "storageLocation" TEXT,
    "storageLocationId" TEXT,
    "binNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maint_wo_spare_parts" (
    "id" TEXT NOT NULL,
    "woId" TEXT NOT NULL,
    "sparePartId" TEXT NOT NULL,
    "quantityRequested" DOUBLE PRECISION NOT NULL,
    "quantityIssued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION,
    "status" "SpareIssueStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,

    CONSTRAINT "maint_wo_spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_meters" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT,
    "lineId" TEXT,
    "areaId" TEXT,
    "deviceId" TEXT,
    "meterNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EnergyType" NOT NULL,
    "unit" TEXT NOT NULL,
    "brand" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "templateKey" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_readings" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workCenterId" TEXT,
    "workOrderId" TEXT,
    "productionOrderId" TEXT,
    "machineId" TEXT,
    "lineId" TEXT,
    "shiftInstanceId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "powerKw" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "machineState" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "quality" TEXT NOT NULL DEFAULT 'GOOD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_wo_summaries" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "totalKwh" DOUBLE PRECISION NOT NULL,
    "runningKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "idleKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downtimeKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kwhPerUnit" DOUBLE PRECISION,
    "kwhPerKgBatch" DOUBLE PRECISION,
    "peakPowerKw" DOUBLE PRECISION,
    "avgPowerKw" DOUBLE PRECISION,
    "anomalyCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_wo_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_wo_machine_kpis" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "meterCount" INTEGER NOT NULL DEFAULT 0,
    "totalKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runningKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "idleKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downtimeKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kwhPerUnit" DOUBLE PRECISION,
    "kwhPerKg" DOUBLE PRECISION,
    "kwhPerRunHour" DOUBLE PRECISION,
    "productiveKwhPerUnit" DOUBLE PRECISION,
    "wastePct" DOUBLE PRECISION,
    "baselineKwhPerUnit" DOUBLE PRECISION,
    "variancePct" DOUBLE PRECISION,
    "peakPowerKw" DOUBLE PRECISION,
    "avgPowerKw" DOUBLE PRECISION,
    "goodQty" DOUBLE PRECISION,
    "outputUnit" TEXT,
    "runMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_wo_machine_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_summaries" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "periodType" "EnergyPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalConsumption" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DOUBLE PRECISION,
    "costCurrency" TEXT NOT NULL DEFAULT 'SAR',
    "productionQty" DOUBLE PRECISION,
    "specificEnergy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grid_emission_factors" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "factorKgPerKwh" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg CO2e/kWh',
    "source" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grid_emission_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_tariffs" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "energyType" "EnergyType" NOT NULL,
    "machineId" TEXT,
    "lineId" TEXT,
    "areaId" TEXT,
    "ratePerUnit" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT,
    "lineId" TEXT,
    "areaId" TEXT,
    "gatewayId" TEXT,
    "name" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "ipAddress" TEXT,
    "port" INTEGER,
    "unitId" INTEGER,
    "serialPort" TEXT,
    "baudRate" INTEGER,
    "parity" TEXT,
    "dataBits" INTEGER,
    "stopBits" INTEGER,
    "pollIntervalMs" INTEGER,
    "connectionString" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "firmware" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_state_rules" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT,
    "state" TEXT NOT NULL,
    "isDowntime" BOOLEAN NOT NULL DEFAULT true,
    "isPlanned" BOOLEAN NOT NULL DEFAULT false,
    "affectsOEE" BOOLEAN NOT NULL DEFAULT true,
    "reasonCode" TEXT,
    "category" "DowntimeCategory" NOT NULL DEFAULT 'OTHER',
    "debounceSeconds" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_state_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_definitions" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT,
    "lineId" TEXT,
    "areaId" TEXT,
    "deviceId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataType" "TagDataType" NOT NULL,
    "unit" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "scaleFactor" DOUBLE PRECISION,
    "offset" DOUBLE PRECISION,
    "tagType" "TagType" NOT NULL DEFAULT 'MEASUREMENT',
    "historizationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "historizationRateSec" INTEGER NOT NULL DEFAULT 60,
    "mqttPublishMode" TEXT NOT NULL DEFAULT 'CHANGE',
    "mqttPublishRateSec" INTEGER NOT NULL DEFAULT 0,
    "historizationMode" TEXT NOT NULL DEFAULT 'CHANGE',
    "deadband" DOUBLE PRECISION,
    "isMachineStatus" BOOLEAN NOT NULL DEFAULT false,
    "statusMap" JSONB,
    "address" TEXT,
    "registerType" TEXT,
    "wordCount" INTEGER DEFAULT 1,
    "wordOrder" TEXT DEFAULT 'BIG',
    "pollIntervalMs" INTEGER,
    "counterRole" "CounterRole",
    "edgeType" TEXT DEFAULT 'RISING',
    "signalRole" TEXT,
    "pulseWindowMs" INTEGER DEFAULT 6000,
    "pulseMinEdges" INTEGER DEFAULT 4,
    "idleThresholdMs" INTEGER DEFAULT 300000,
    "meterId" TEXT,
    "energyRole" TEXT,
    "spcParameterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_current_values" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "quality" "TagQuality" NOT NULL DEFAULT 'GOOD',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "tag_current_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateways" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_counter_states" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "lastRawValue" DOUBLE PRECISION,
    "accumulated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobOrderId" TEXT,
    "lastEdgeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_counter_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_definitions" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "tagId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" "AlarmSeverity" NOT NULL DEFAULT 'HIGH',
    "category" TEXT NOT NULL DEFAULT 'PROCESS',
    "condition" TEXT,
    "threshold" DOUBLE PRECISION,
    "deadband" DOUBLE PRECISION,
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "autoAck" BOOLEAN NOT NULL DEFAULT false,
    "notifyRoles" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_events" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "alarmDefinitionId" TEXT,
    "machineId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "AlarmSeverity" NOT NULL,
    "category" TEXT,
    "value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "durationMinutes" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "factoryId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "department" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "notifySMS" BOOLEAN NOT NULL DEFAULT false,
    "passwordResetToken" TEXT,
    "passwordResetExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "factoryId" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "factoryId" TEXT,
    "type" "NotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM',
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "link" TEXT,
    "priority" "AlarmSeverity" NOT NULL DEFAULT 'HIGH',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "minSeverity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "condition" JSONB,
    "channels" JSONB NOT NULL,
    "recipients" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_materials" (
    "archivedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "unitId" TEXT,
    "unitCost" DOUBLE PRECISION,
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxStock" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "storageLocation" TEXT,
    "storageLocationId" TEXT,
    "supplierName" TEXT,
    "leadTimeDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_headers" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "notes" TEXT,
    "processId" TEXT,
    "sourceType" "BomSource" NOT NULL DEFAULT 'MANUAL',
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bom_headers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_items" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "quantityPer" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitId" TEXT,
    "scrapFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "routingStepId" TEXT,

    CONSTRAINT "bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "entityType" "StockEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "stockBefore" DOUBLE PRECISION,
    "stockAfter" DOUBLE PRECISION,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "referenceNumber" TEXT,
    "performedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_events" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityCode" TEXT,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "quantity" DOUBLE PRECISION,
    "eventData" JSONB,
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,

    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traceability_links" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "parentType" "TraceEntityType" NOT NULL,
    "parentId" TEXT NOT NULL,
    "childType" "TraceEntityType" NOT NULL,
    "childId" TEXT NOT NULL,
    "linkType" "TraceLinkType" NOT NULL,
    "qty" DOUBLE PRECISION,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traceability_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" "StorageZone" NOT NULL,
    "description" TEXT,
    "capacity" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_goods_lots" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "batchRecordId" TEXT,
    "storageLocationId" TEXT,
    "lotNumber" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remainingQty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "producedQty" DOUBLE PRECISION,
    "producedUnit" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "productionOrderId" TEXT,
    "rawMaterialId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "quantityNeeded" DOUBLE PRECISION NOT NULL,
    "quantityAvailable" DOUBLE PRECISION NOT NULL,
    "quantityShort" DOUBLE PRECISION NOT NULL,
    "quantityFulfilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "deliveryDate" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "notes" TEXT,
    "responseNotes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_transfers" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "entityType" "StockEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "materialLotId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "notes" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_processes" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "skuId" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalCycleTimeMins" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scopeType" "ProcessScope" NOT NULL DEFAULT 'PRODUCT',
    "categoryId" TEXT,
    "baseWeightId" TEXT,

    CONSTRAINT "manufacturing_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_process_skus" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,

    CONSTRAINT "manufacturing_process_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_steps" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "operationName" TEXT NOT NULL,
    "workCenter" TEXT,
    "machineId" TEXT,
    "cycleTimeSec" DOUBLE PRECISION,
    "cycleTimeMins" DOUBLE PRECISION,
    "setupTimeMins" DOUBLE PRECISION,
    "inUnit" TEXT,
    "outUnit" TEXT,
    "description" TEXT,
    "parameters" JSONB,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workCenterId" TEXT,

    CONSTRAINT "routing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_step_machine_options" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "cycleTimeSec" DOUBLE PRECISION,
    "setupTimeMins" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_step_machine_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_step_materials" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "materialCode" TEXT,
    "name" TEXT NOT NULL,
    "qtyPerOutputUnit" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_step_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_centers" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "WorkCenterLevel" NOT NULL,
    "description" TEXT,
    "capacity" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_dependencies" (
    "id" TEXT NOT NULL,
    "fromStepId" TEXT NOT NULL,
    "toStepId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagMins" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "step_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "processId" TEXT,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "batchSize" DOUBLE PRECISION,
    "batchUnit" TEXT,
    "yieldPct" DOUBLE PRECISION,
    "cycleTimeSecs" DOUBLE PRECISION,
    "shelfLifeDays" INTEGER,
    "storageConditions" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "phase" TEXT,
    "quantityPer" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "scrapFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_orders" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "routingStepId" TEXT,
    "machineId" TEXT,
    "workCenterId" TEXT,
    "sequenceOrder" INTEGER NOT NULL,
    "operationName" TEXT NOT NULL,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "predecessorId" TEXT,
    "predecessorType" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "predecessorLagMins" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "plannedQtyIn" DOUBLE PRECISION,
    "plannedQtyOut" DOUBLE PRECISION,
    "actualQtyGood" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualQtyRejected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualQtyGood" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualQtyRejected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceAdjGood" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceAdjRejected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balancedAt" TIMESTAMP(3),
    "handoverQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "handoverCriteria" DOUBLE PRECISION,
    "outputUnit" TEXT,
    "inputUnit" TEXT,
    "idealCycleTimeSec" DOUBLE PRECISION,
    "bypassedAt" TIMESTAMP(3),
    "bypassedBy" TEXT,
    "bypassReason" TEXT,
    "operatorId" TEXT,
    "scrapReason" TEXT,
    "assignmentReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_logs" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "operatorId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "qtyUnit" TEXT NOT NULL DEFAULT 'PIECE',
    "reason" TEXT NOT NULL,
    "category" "ScrapCategory" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrap_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_materials" (
    "id" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "materialLotId" TEXT,
    "plannedQty" DOUBLE PRECISION NOT NULL,
    "actualQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,

    CONSTRAINT "job_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_categories" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "enterpriseId" TEXT,
    "categoryId" TEXT,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "source" "DashboardSource" NOT NULL DEFAULT 'Industry360_NATIVE',
    "type" "DashboardType" NOT NULL DEFAULT 'OPERATIONAL',
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'FACTORY',
    "route" TEXT,
    "externalUrl" TEXT,
    "grafanaUid" TEXT,
    "grafanaSlug" TEXT,
    "grafanaOrgId" INTEGER,
    "grafanaFolder" TEXT,
    "icon" TEXT,
    "thumbnailUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isFactoryAware" BOOLEAN NOT NULL DEFAULT true,
    "supportedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultTimeRange" TEXT DEFAULT 'now-24h',
    "refreshInterval" TEXT DEFAULT '30s',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateOfId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_favorites" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_permissions" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "role" "UserRole",
    "userId" TEXT,
    "level" "DashboardPermissionLevel" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'EVIDENCE',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_dashboards" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "backgroundImageUrl" TEXT,
    "backgroundSettings" JSONB,
    "canvasSettings" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedSnapshot" JSONB,
    "publishedVersion" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plant_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "widgetType" TEXT NOT NULL,
    "title" TEXT,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 220,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 140,
    "zIndex" INTEGER NOT NULL DEFAULT 1,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "scopeConfig" JSONB,
    "dataConfig" JSONB,
    "displayConfig" JSONB,
    "refreshConfig" JSONB,
    "thresholdConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plant_dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_stop_templates" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "scope" "PlannedStopScope" NOT NULL DEFAULT 'LINE',
    "causeId" TEXT,
    "category" "DowntimeCategory" NOT NULL DEFAULT 'PLANNED_BREAK',
    "shiftTemplateId" TEXT,
    "startOffsetMin" INTEGER,
    "scheduleRuleId" TEXT,
    "startTimeLocal" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planned_stop_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_stop_targets" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "lineId" TEXT,
    "machineId" TEXT,

    CONSTRAINT "planned_stop_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_rules" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysOfWeek" JSONB NOT NULL DEFAULT '[]',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isPerpetual" BOOLEAN NOT NULL DEFAULT false,
    "oneOffDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_stop_rules" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "WorkOrderStopTrigger" NOT NULL DEFAULT 'PRODUCT_CHANGE',
    "durationMinutes" INTEGER NOT NULL,
    "causeId" TEXT,
    "category" "DowntimeCategory" NOT NULL DEFAULT 'CHANGEOVER',
    "affectsOEE" BOOLEAN NOT NULL DEFAULT true,
    "isPlanned" BOOLEAN NOT NULL DEFAULT true,
    "lineId" TEXT,
    "machineId" TEXT,
    "skuId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_stop_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_attainment_daily" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "factoryId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "lineId" TEXT,
    "skuId" TEXT,
    "scheduledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_attainment_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oee_minutes" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "shiftTemplateId" TEXT,
    "shiftCode" TEXT,
    "machineState" TEXT,
    "jobOrderStatus" TEXT NOT NULL,
    "committedFrom" TIMESTAMP(3),
    "committedTo" TIMESTAMP(3),
    "totalMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedStopMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availabilityLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmeasuredMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatingMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "microStopMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rejectedParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "theoreticalParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "designSpeedPph" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oee_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oee_schedule_minutes" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "shiftTemplateId" TEXT,
    "shiftCode" TEXT,
    "machineState" TEXT,
    "jobOrderStatus" TEXT NOT NULL,
    "committedFrom" TIMESTAMP(3) NOT NULL,
    "committedTo" TIMESTAMP(3) NOT NULL,
    "totalMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedStopMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availabilityLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmeasuredMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatingMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rejectedParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "theoreticalParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "designSpeedPph" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oee_schedule_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_balance_config" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isAnchor" BOOLEAN NOT NULL DEFAULT false,
    "bufferToNextQty" DOUBLE PRECISION,
    "bufferUnit" TEXT,
    "transitSec" INTEGER,
    "maxCorrectionPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "applyAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_balance_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_adjustments" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedGood" DOUBLE PRECISION NOT NULL,
    "countedScrap" DOUBLE PRECISION NOT NULL,
    "adjGood" DOUBLE PRECISION NOT NULL,
    "adjScrap" DOUBLE PRECISION NOT NULL,
    "anchorMachineId" TEXT,
    "reason" TEXT NOT NULL,
    "clamped" BOOLEAN NOT NULL DEFAULT false,
    "requestedGood" DOUBLE PRECISION,

    CONSTRAINT "count_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enterprises_code_key" ON "enterprises"("code");

-- CreateIndex
CREATE UNIQUE INDEX "factories_code_key" ON "factories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_factoryId_code_key" ON "areas"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_factoryId_code_key" ON "production_lines"("factoryId", "code");

-- CreateIndex
CREATE INDEX "machines_factoryId_idx" ON "machines"("factoryId");

-- CreateIndex
CREATE INDEX "machines_lineId_idx" ON "machines"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "machines_factoryId_code_key" ON "machines"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "machine_modules_machineId_code_key" ON "machine_modules"("machineId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "machine_current_status_machineId_key" ON "machine_current_status"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "machine_cycle_times_machineId_skuId_unitType_key" ON "machine_cycle_times"("machineId", "skuId", "unitType");

-- CreateIndex
CREATE UNIQUE INDEX "product_families_factoryId_code_key" ON "product_families"("factoryId", "code");

-- CreateIndex
CREATE INDEX "change_requests_factoryId_status_idx" ON "change_requests"("factoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_factoryId_crNumber_key" ON "change_requests"("factoryId", "crNumber");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_factoryId_name_key" ON "product_categories"("factoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_brands_factoryId_name_key" ON "product_brands"("factoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_types_factoryId_name_key" ON "packaging_types"("factoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "base_units_factoryId_code_key" ON "base_units"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "base_weights_factoryId_value_unit_key" ON "base_weights"("factoryId", "value", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_factoryId_code_key" ON "units_of_measure"("factoryId", "code");

-- CreateIndex
CREATE INDEX "skus_factoryId_idx" ON "skus"("factoryId");

-- CreateIndex
CREATE INDEX "skus_categoryId_idx" ON "skus"("categoryId");

-- CreateIndex
CREATE INDEX "skus_baseWeightId_idx" ON "skus"("baseWeightId");

-- CreateIndex
CREATE UNIQUE INDEX "skus_factoryId_itemNumber_key" ON "skus"("factoryId", "itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_orderNumber_key" ON "production_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "production_orders_factoryId_status_idx" ON "production_orders"("factoryId", "status");

-- CreateIndex
CREATE INDEX "reschedule_requests_factoryId_status_idx" ON "reschedule_requests"("factoryId", "status");

-- CreateIndex
CREATE INDEX "reschedule_requests_productionOrderId_idx" ON "reschedule_requests"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_orderNumber_key" ON "work_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "work_orders_factoryId_status_idx" ON "work_orders"("factoryId", "status");

-- CreateIndex
CREATE INDEX "work_orders_factoryId_plannedStart_idx" ON "work_orders"("factoryId", "plannedStart");

-- CreateIndex
CREATE INDEX "production_events_factoryId_timestamp_idx" ON "production_events"("factoryId", "timestamp");

-- CreateIndex
CREATE INDEX "production_events_machineId_timestamp_idx" ON "production_events"("machineId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "batch_records_batchNumber_key" ON "batch_records"("batchNumber");

-- CreateIndex
CREATE INDEX "batch_records_factoryId_idx" ON "batch_records"("factoryId");

-- CreateIndex
CREATE INDEX "batch_records_lotNumber_idx" ON "batch_records"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_factoryId_lotNumber_materialCode_key" ON "material_lots"("factoryId", "lotNumber", "materialCode");

-- CreateIndex
CREATE INDEX "material_consumptions_batchRecordId_idx" ON "material_consumptions"("batchRecordId");

-- CreateIndex
CREATE INDEX "material_consumptions_materialLotId_idx" ON "material_consumptions"("materialLotId");

-- CreateIndex
CREATE INDEX "material_consumptions_jobOrderId_idx" ON "material_consumptions"("jobOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "genealogy_links_parentBatchId_childBatchId_key" ON "genealogy_links"("parentBatchId", "childBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_templates_factoryId_code_key" ON "shift_templates"("factoryId", "code");

-- CreateIndex
CREATE INDEX "production_order_stops_productionOrderId_idx" ON "production_order_stops"("productionOrderId");

-- CreateIndex
CREATE INDEX "shift_breaks_shiftTemplateId_idx" ON "shift_breaks"("shiftTemplateId");

-- CreateIndex
CREATE INDEX "shift_instances_factoryId_shiftDate_idx" ON "shift_instances"("factoryId", "shiftDate");

-- CreateIndex
CREATE INDEX "machine_state_records_factoryId_startTime_idx" ON "machine_state_records"("factoryId", "startTime");

-- CreateIndex
CREATE INDEX "machine_state_records_machineId_startTime_idx" ON "machine_state_records"("machineId", "startTime");

-- CreateIndex
CREATE INDEX "downtime_causes_factoryId_idx" ON "downtime_causes"("factoryId");

-- CreateIndex
CREATE INDEX "downtime_causes_machineId_idx" ON "downtime_causes"("machineId");

-- CreateIndex
CREATE INDEX "downtime_causes_parentId_idx" ON "downtime_causes"("parentId");

-- CreateIndex
CREATE INDEX "downtime_events_factoryId_startTime_idx" ON "downtime_events"("factoryId", "startTime");

-- CreateIndex
CREATE INDEX "downtime_events_machineId_startTime_idx" ON "downtime_events"("machineId", "startTime");

-- CreateIndex
CREATE INDEX "downtime_events_workCenterId_startTime_idx" ON "downtime_events"("workCenterId", "startTime");

-- CreateIndex
CREATE INDEX "downtime_events_reasonCode_idx" ON "downtime_events"("reasonCode");

-- CreateIndex
CREATE INDEX "oee_records_factoryId_recordDate_idx" ON "oee_records"("factoryId", "recordDate");

-- CreateIndex
CREATE INDEX "oee_records_machineId_recordDate_idx" ON "oee_records"("machineId", "recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "machine_runtime_hours_machineId_recordDate_key" ON "machine_runtime_hours"("machineId", "recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_results_inspectionNumber_key" ON "inspection_results"("inspectionNumber");

-- CreateIndex
CREATE INDEX "inspection_results_factoryId_inspectedAt_idx" ON "inspection_results"("factoryId", "inspectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ncrs_ncrNumber_key" ON "ncrs"("ncrNumber");

-- CreateIndex
CREATE INDEX "ncrs_factoryId_status_idx" ON "ncrs"("factoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capas_capaNumber_key" ON "capas"("capaNumber");

-- CreateIndex
CREATE INDEX "spc_measurements_factoryId_measuredAt_idx" ON "spc_measurements"("factoryId", "measuredAt");

-- CreateIndex
CREATE INDEX "spc_measurements_machineId_parameterName_measuredAt_idx" ON "spc_measurements"("machineId", "parameterName", "measuredAt");

-- CreateIndex
CREATE INDEX "failure_modes_machineId_idx" ON "failure_modes"("machineId");

-- CreateIndex
CREATE INDEX "maintenance_wo_failure_modes_failureModeId_idx" ON "maintenance_wo_failure_modes"("failureModeId");

-- CreateIndex
CREATE INDEX "pm_tasks_factoryId_scheduledDate_idx" ON "pm_tasks"("factoryId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_wos_woNumber_key" ON "maintenance_wos"("woNumber");

-- CreateIndex
CREATE INDEX "maintenance_wos_factoryId_status_idx" ON "maintenance_wos"("factoryId", "status");

-- CreateIndex
CREATE INDEX "maintenance_wos_machineId_idx" ON "maintenance_wos"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "spare_parts_factoryId_partNumber_key" ON "spare_parts"("factoryId", "partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "energy_meters_deviceId_key" ON "energy_meters"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "energy_meters_factoryId_meterNumber_key" ON "energy_meters"("factoryId", "meterNumber");

-- CreateIndex
CREATE INDEX "energy_readings_meterId_timestamp_idx" ON "energy_readings"("meterId", "timestamp");

-- CreateIndex
CREATE INDEX "energy_readings_factoryId_timestamp_idx" ON "energy_readings"("factoryId", "timestamp");

-- CreateIndex
CREATE INDEX "energy_readings_workOrderId_idx" ON "energy_readings"("workOrderId");

-- CreateIndex
CREATE INDEX "energy_readings_workCenterId_timestamp_idx" ON "energy_readings"("workCenterId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "energy_wo_summaries_workOrderId_key" ON "energy_wo_summaries"("workOrderId");

-- CreateIndex
CREATE INDEX "energy_wo_machine_kpis_factoryId_computedAt_idx" ON "energy_wo_machine_kpis"("factoryId", "computedAt");

-- CreateIndex
CREATE INDEX "energy_wo_machine_kpis_machineId_computedAt_idx" ON "energy_wo_machine_kpis"("machineId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_wo_machine_kpis_workOrderId_machineId_key" ON "energy_wo_machine_kpis"("workOrderId", "machineId");

-- CreateIndex
CREATE INDEX "energy_summaries_meterId_periodStart_idx" ON "energy_summaries"("meterId", "periodStart");

-- CreateIndex
CREATE INDEX "grid_emission_factors_factoryId_isActive_effectiveFrom_idx" ON "grid_emission_factors"("factoryId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "energy_tariffs_factoryId_energyType_isActive_idx" ON "energy_tariffs"("factoryId", "energyType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceCode_key" ON "devices"("deviceCode");

-- CreateIndex
CREATE INDEX "devices_factoryId_idx" ON "devices"("factoryId");

-- CreateIndex
CREATE INDEX "devices_gatewayId_idx" ON "devices"("gatewayId");

-- CreateIndex
CREATE INDEX "devices_lineId_idx" ON "devices"("lineId");

-- CreateIndex
CREATE INDEX "devices_areaId_idx" ON "devices"("areaId");

-- CreateIndex
CREATE INDEX "machine_state_rules_factoryId_isActive_idx" ON "machine_state_rules"("factoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "machine_state_rules_factoryId_machineId_state_key" ON "machine_state_rules"("factoryId", "machineId", "state");

-- CreateIndex
CREATE INDEX "tag_definitions_meterId_idx" ON "tag_definitions"("meterId");

-- CreateIndex
CREATE INDEX "tag_definitions_lineId_idx" ON "tag_definitions"("lineId");

-- CreateIndex
CREATE INDEX "tag_definitions_areaId_idx" ON "tag_definitions"("areaId");

-- CreateIndex
CREATE INDEX "tag_definitions_spcParameterId_idx" ON "tag_definitions"("spcParameterId");

-- CreateIndex
CREATE UNIQUE INDEX "tag_definitions_factoryId_code_key" ON "tag_definitions"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tag_current_values_tagId_key" ON "tag_current_values"("tagId");

-- CreateIndex
CREATE INDEX "gateways_factoryId_idx" ON "gateways"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_counter_states_tagId_key" ON "gateway_counter_states"("tagId");

-- CreateIndex
CREATE INDEX "alarm_events_factoryId_triggeredAt_idx" ON "alarm_events"("factoryId", "triggeredAt");

-- CreateIndex
CREATE INDEX "alarm_events_machineId_triggeredAt_idx" ON "alarm_events"("machineId", "triggeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "users"("passwordResetToken");

-- CreateIndex
CREATE INDEX "users_enterpriseId_idx" ON "users"("enterpriseId");

-- CreateIndex
CREATE INDEX "users_factoryId_idx" ON "users"("factoryId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "role_permissions_role_idx" ON "role_permissions"("role");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_permissionId_key" ON "role_permissions"("role", "permissionId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_factoryId_createdAt_idx" ON "notifications"("factoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE INDEX "audit_logs_factoryId_createdAt_idx" ON "audit_logs"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_factoryId_code_key" ON "raw_materials"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bom_headers_skuId_version_key" ON "bom_headers"("skuId", "version");

-- CreateIndex
CREATE INDEX "stock_movements_factoryId_createdAt_idx" ON "stock_movements"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_entityType_entityId_idx" ON "stock_movements"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "trace_events_entityType_entityId_idx" ON "trace_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "trace_events_factoryId_performedAt_idx" ON "trace_events"("factoryId", "performedAt");

-- CreateIndex
CREATE INDEX "trace_events_performedAt_idx" ON "trace_events"("performedAt");

-- CreateIndex
CREATE INDEX "traceability_links_parentId_idx" ON "traceability_links"("parentId");

-- CreateIndex
CREATE INDEX "traceability_links_childId_idx" ON "traceability_links"("childId");

-- CreateIndex
CREATE INDEX "traceability_links_factoryId_createdAt_idx" ON "traceability_links"("factoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_factoryId_code_key" ON "storage_locations"("factoryId", "code");

-- CreateIndex
CREATE INDEX "finished_goods_lots_factoryId_skuId_idx" ON "finished_goods_lots"("factoryId", "skuId");

-- CreateIndex
CREATE INDEX "finished_goods_lots_storageLocationId_idx" ON "finished_goods_lots"("storageLocationId");

-- CreateIndex
CREATE INDEX "finished_goods_lots_workOrderId_idx" ON "finished_goods_lots"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_requestNumber_key" ON "material_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "material_requests_factoryId_status_idx" ON "material_requests"("factoryId", "status");

-- CreateIndex
CREATE INDEX "material_requests_workOrderId_idx" ON "material_requests"("workOrderId");

-- CreateIndex
CREATE INDEX "material_requests_rawMaterialId_idx" ON "material_requests"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_transfers_transferNumber_key" ON "storage_transfers"("transferNumber");

-- CreateIndex
CREATE INDEX "storage_transfers_factoryId_createdAt_idx" ON "storage_transfers"("factoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_processes_skuId_version_key" ON "manufacturing_processes"("skuId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_process_skus_processId_skuId_key" ON "manufacturing_process_skus"("processId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "routing_steps_processId_stepNumber_key" ON "routing_steps"("processId", "stepNumber");

-- CreateIndex
CREATE INDEX "routing_step_machine_options_stepId_idx" ON "routing_step_machine_options"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "routing_step_machine_options_stepId_machineId_key" ON "routing_step_machine_options"("stepId", "machineId");

-- CreateIndex
CREATE INDEX "routing_step_materials_stepId_idx" ON "routing_step_materials"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "work_centers_factoryId_code_key" ON "work_centers"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "step_dependencies_fromStepId_toStepId_key" ON "step_dependencies"("fromStepId", "toStepId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_skuId_version_key" ON "recipes"("skuId", "version");

-- CreateIndex
CREATE INDEX "job_orders_workOrderId_idx" ON "job_orders"("workOrderId");

-- CreateIndex
CREATE INDEX "job_orders_factoryId_status_idx" ON "job_orders"("factoryId", "status");

-- CreateIndex
CREATE INDEX "job_orders_machineId_idx" ON "job_orders"("machineId");

-- CreateIndex
CREATE INDEX "scrap_logs_factoryId_createdAt_idx" ON "scrap_logs"("factoryId", "createdAt");

-- CreateIndex
CREATE INDEX "scrap_logs_jobOrderId_idx" ON "scrap_logs"("jobOrderId");

-- CreateIndex
CREATE INDEX "scrap_logs_workOrderId_idx" ON "scrap_logs"("workOrderId");

-- CreateIndex
CREATE INDEX "job_order_materials_jobOrderId_idx" ON "job_order_materials"("jobOrderId");

-- CreateIndex
CREATE INDEX "dashboard_categories_factoryId_idx" ON "dashboard_categories"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_categories_factoryId_key_key" ON "dashboard_categories"("factoryId", "key");

-- CreateIndex
CREATE INDEX "dashboards_factoryId_source_idx" ON "dashboards"("factoryId", "source");

-- CreateIndex
CREATE INDEX "dashboards_categoryId_idx" ON "dashboards"("categoryId");

-- CreateIndex
CREATE INDEX "dashboards_type_idx" ON "dashboards"("type");

-- CreateIndex
CREATE INDEX "dashboards_isTemplate_idx" ON "dashboards"("isTemplate");

-- CreateIndex
CREATE INDEX "dashboard_favorites_userId_idx" ON "dashboard_favorites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_favorites_dashboardId_userId_key" ON "dashboard_favorites"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "dashboard_permissions_dashboardId_idx" ON "dashboard_permissions"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_permissions_userId_idx" ON "dashboard_permissions"("userId");

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "attachments_factoryId_idx" ON "attachments"("factoryId");

-- CreateIndex
CREATE INDEX "plant_dashboards_factoryId_entityType_entityId_idx" ON "plant_dashboards"("factoryId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "plant_dashboards_entityType_entityId_status_idx" ON "plant_dashboards"("entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "plant_dashboard_widgets_dashboardId_idx" ON "plant_dashboard_widgets"("dashboardId");

-- CreateIndex
CREATE INDEX "planned_stop_templates_factoryId_isActive_idx" ON "planned_stop_templates"("factoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "planned_stop_templates_factoryId_code_key" ON "planned_stop_templates"("factoryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "planned_stop_targets_templateId_lineId_machineId_key" ON "planned_stop_targets"("templateId", "lineId", "machineId");

-- CreateIndex
CREATE INDEX "schedule_rules_factoryId_isActive_idx" ON "schedule_rules"("factoryId", "isActive");

-- CreateIndex
CREATE INDEX "work_order_stop_rules_factoryId_isActive_idx" ON "work_order_stop_rules"("factoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_stop_rules_factoryId_code_key" ON "work_order_stop_rules"("factoryId", "code");

-- CreateIndex
CREATE INDEX "schedule_attainment_daily_factoryId_day_idx" ON "schedule_attainment_daily"("factoryId", "day");

-- CreateIndex
CREATE INDEX "schedule_attainment_daily_lineId_day_idx" ON "schedule_attainment_daily"("lineId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_attainment_daily_productionOrderId_day_key" ON "schedule_attainment_daily"("productionOrderId", "day");

-- CreateIndex
CREATE INDEX "oee_minutes_machineId_bucketStart_idx" ON "oee_minutes"("machineId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_minutes_factoryId_bucketStart_idx" ON "oee_minutes"("factoryId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_minutes_shiftTemplateId_bucketStart_idx" ON "oee_minutes"("shiftTemplateId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_minutes_workOrderId_idx" ON "oee_minutes"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "oee_minutes_jobOrderId_bucketStart_key" ON "oee_minutes"("jobOrderId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_schedule_minutes_machineId_bucketStart_idx" ON "oee_schedule_minutes"("machineId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_schedule_minutes_factoryId_bucketStart_idx" ON "oee_schedule_minutes"("factoryId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_schedule_minutes_shiftTemplateId_bucketStart_idx" ON "oee_schedule_minutes"("shiftTemplateId", "bucketStart");

-- CreateIndex
CREATE INDEX "oee_schedule_minutes_workOrderId_idx" ON "oee_schedule_minutes"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "oee_schedule_minutes_jobOrderId_bucketStart_key" ON "oee_schedule_minutes"("jobOrderId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "line_balance_config_machineId_key" ON "line_balance_config"("machineId");

-- CreateIndex
CREATE INDEX "line_balance_config_factoryId_idx" ON "line_balance_config"("factoryId");

-- CreateIndex
CREATE INDEX "count_adjustments_jobOrderId_idx" ON "count_adjustments"("jobOrderId");

-- CreateIndex
CREATE INDEX "count_adjustments_machineId_at_idx" ON "count_adjustments"("machineId", "at");

-- AddForeignKey
ALTER TABLE "factories" ADD CONSTRAINT "factories_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_modules" ADD CONSTRAINT "machine_modules_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_current_status" ADD CONSTRAINT "machine_current_status_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_cycle_times" ADD CONSTRAINT "machine_cycle_times_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_cycle_times" ADD CONSTRAINT "machine_cycle_times_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_processId_fkey" FOREIGN KEY ("processId") REFERENCES "manufacturing_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_brands" ADD CONSTRAINT "product_brands_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_types" ADD CONSTRAINT "packaging_types_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_units" ADD CONSTRAINT "base_units_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_weights" ADD CONSTRAINT "base_weights_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "product_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "base_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_baseWeightId_fkey" FOREIGN KEY ("baseWeightId") REFERENCES "base_weights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "material_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_batchRecordId_fkey" FOREIGN KEY ("batchRecordId") REFERENCES "batch_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genealogy_links" ADD CONSTRAINT "genealogy_links_parentBatchId_fkey" FOREIGN KEY ("parentBatchId") REFERENCES "batch_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genealogy_links" ADD CONSTRAINT "genealogy_links_childBatchId_fkey" FOREIGN KEY ("childBatchId") REFERENCES "batch_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "schedule_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stops" ADD CONSTRAINT "production_order_stops_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_breaks" ADD CONSTRAINT "shift_breaks_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_records" ADD CONSTRAINT "machine_state_records_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_records" ADD CONSTRAINT "machine_state_records_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_records" ADD CONSTRAINT "machine_state_records_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_records" ADD CONSTRAINT "machine_state_records_downtimeCauseId_fkey" FOREIGN KEY ("downtimeCauseId") REFERENCES "downtime_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_causes" ADD CONSTRAINT "downtime_causes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "downtime_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_causes" ADD CONSTRAINT "downtime_causes_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_causes" ADD CONSTRAINT "downtime_causes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "downtime_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_records" ADD CONSTRAINT "oee_records_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_records" ADD CONSTRAINT "oee_records_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_records" ADD CONSTRAINT "oee_records_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_runtime_hours" ADD CONSTRAINT "machine_runtime_hours_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_plans" ADD CONSTRAINT "quality_plans_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_parameters" ADD CONSTRAINT "quality_parameters_planId_fkey" FOREIGN KEY ("planId") REFERENCES "quality_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_planId_fkey" FOREIGN KEY ("planId") REFERENCES "quality_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_batchRecordId_fkey" FOREIGN KEY ("batchRecordId") REFERENCES "batch_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_detectedById_fkey" FOREIGN KEY ("detectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "ncrs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_capaId_fkey" FOREIGN KEY ("capaId") REFERENCES "capas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spc_measurements" ADD CONSTRAINT "spc_measurements_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spc_measurements" ADD CONSTRAINT "spc_measurements_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_modes" ADD CONSTRAINT "failure_modes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wo_failure_modes" ADD CONSTRAINT "maintenance_wo_failure_modes_woId_fkey" FOREIGN KEY ("woId") REFERENCES "maintenance_wos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wo_failure_modes" ADD CONSTRAINT "maintenance_wo_failure_modes_failureModeId_fkey" FOREIGN KEY ("failureModeId") REFERENCES "failure_modes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_plans" ADD CONSTRAINT "pm_plans_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_plans" ADD CONSTRAINT "pm_plans_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_plan_spare_parts" ADD CONSTRAINT "pm_plan_spare_parts_pmPlanId_fkey" FOREIGN KEY ("pmPlanId") REFERENCES "pm_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_plan_spare_parts" ADD CONSTRAINT "pm_plan_spare_parts_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "pm_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wos" ADD CONSTRAINT "maintenance_wos_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wos" ADD CONSTRAINT "maintenance_wos_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wos" ADD CONSTRAINT "maintenance_wos_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wos" ADD CONSTRAINT "maintenance_wos_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wos" ADD CONSTRAINT "maintenance_wos_productionWOId_fkey" FOREIGN KEY ("productionWOId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maint_wo_spare_parts" ADD CONSTRAINT "maint_wo_spare_parts_woId_fkey" FOREIGN KEY ("woId") REFERENCES "maintenance_wos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maint_wo_spare_parts" ADD CONSTRAINT "maint_wo_spare_parts_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maint_wo_spare_parts" ADD CONSTRAINT "maint_wo_spare_parts_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_meters" ADD CONSTRAINT "energy_meters_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_readings" ADD CONSTRAINT "energy_readings_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_readings" ADD CONSTRAINT "energy_readings_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_readings" ADD CONSTRAINT "energy_readings_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_wo_summaries" ADD CONSTRAINT "energy_wo_summaries_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_wo_summaries" ADD CONSTRAINT "energy_wo_summaries_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_wo_machine_kpis" ADD CONSTRAINT "energy_wo_machine_kpis_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_wo_machine_kpis" ADD CONSTRAINT "energy_wo_machine_kpis_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_wo_machine_kpis" ADD CONSTRAINT "energy_wo_machine_kpis_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_summaries" ADD CONSTRAINT "energy_summaries_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_summaries" ADD CONSTRAINT "energy_summaries_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grid_emission_factors" ADD CONSTRAINT "grid_emission_factors_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_rules" ADD CONSTRAINT "machine_state_rules_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_state_rules" ADD CONSTRAINT "machine_state_rules_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_spcParameterId_fkey" FOREIGN KEY ("spcParameterId") REFERENCES "quality_parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_current_values" ADD CONSTRAINT "tag_current_values_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_counter_states" ADD CONSTRAINT "gateway_counter_states_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_definitions" ADD CONSTRAINT "alarm_definitions_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_definitions" ADD CONSTRAINT "alarm_definitions_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_alarmDefinitionId_fkey" FOREIGN KEY ("alarmDefinitionId") REFERENCES "alarm_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_headers" ADD CONSTRAINT "bom_headers_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_headers" ADD CONSTRAINT "bom_headers_processId_fkey" FOREIGN KEY ("processId") REFERENCES "manufacturing_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "bom_headers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_routingStepId_fkey" FOREIGN KEY ("routingStepId") REFERENCES "routing_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traceability_links" ADD CONSTRAINT "traceability_links_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_transfers" ADD CONSTRAINT "storage_transfers_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_transfers" ADD CONSTRAINT "storage_transfers_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_transfers" ADD CONSTRAINT "storage_transfers_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_transfers" ADD CONSTRAINT "storage_transfers_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_processes" ADD CONSTRAINT "manufacturing_processes_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_processes" ADD CONSTRAINT "manufacturing_processes_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_processes" ADD CONSTRAINT "manufacturing_processes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_processes" ADD CONSTRAINT "manufacturing_processes_baseWeightId_fkey" FOREIGN KEY ("baseWeightId") REFERENCES "base_weights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_process_skus" ADD CONSTRAINT "manufacturing_process_skus_processId_fkey" FOREIGN KEY ("processId") REFERENCES "manufacturing_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_process_skus" ADD CONSTRAINT "manufacturing_process_skus_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_processId_fkey" FOREIGN KEY ("processId") REFERENCES "manufacturing_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_step_machine_options" ADD CONSTRAINT "routing_step_machine_options_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "routing_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_step_machine_options" ADD CONSTRAINT "routing_step_machine_options_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_step_materials" ADD CONSTRAINT "routing_step_materials_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "routing_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_step_materials" ADD CONSTRAINT "routing_step_materials_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_step_materials" ADD CONSTRAINT "routing_step_materials_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES "routing_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES "routing_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_processId_fkey" FOREIGN KEY ("processId") REFERENCES "manufacturing_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_routingStepId_fkey" FOREIGN KEY ("routingStepId") REFERENCES "routing_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_logs" ADD CONSTRAINT "scrap_logs_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_logs" ADD CONSTRAINT "scrap_logs_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_logs" ADD CONSTRAINT "scrap_logs_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_logs" ADD CONSTRAINT "scrap_logs_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_materials" ADD CONSTRAINT "job_order_materials_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_materials" ADD CONSTRAINT "job_order_materials_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "dashboard_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_favorites" ADD CONSTRAINT "dashboard_favorites_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_dashboard_widgets" ADD CONSTRAINT "plant_dashboard_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "plant_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_templates" ADD CONSTRAINT "planned_stop_templates_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_templates" ADD CONSTRAINT "planned_stop_templates_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "downtime_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_templates" ADD CONSTRAINT "planned_stop_templates_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_templates" ADD CONSTRAINT "planned_stop_templates_scheduleRuleId_fkey" FOREIGN KEY ("scheduleRuleId") REFERENCES "schedule_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_targets" ADD CONSTRAINT "planned_stop_targets_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "planned_stop_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_targets" ADD CONSTRAINT "planned_stop_targets_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_stop_targets" ADD CONSTRAINT "planned_stop_targets_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_stop_rules" ADD CONSTRAINT "work_order_stop_rules_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_stop_rules" ADD CONSTRAINT "work_order_stop_rules_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "downtime_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_stop_rules" ADD CONSTRAINT "work_order_stop_rules_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_stop_rules" ADD CONSTRAINT "work_order_stop_rules_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_stop_rules" ADD CONSTRAINT "work_order_stop_rules_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attainment_daily" ADD CONSTRAINT "schedule_attainment_daily_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_attainment_daily" ADD CONSTRAINT "schedule_attainment_daily_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_balance_config" ADD CONSTRAINT "line_balance_config_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
