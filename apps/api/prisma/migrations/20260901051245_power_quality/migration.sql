-- CreateEnum
CREATE TYPE "PqEventType" AS ENUM ('SAG', 'SWELL', 'INTERRUPTION', 'TRANSIENT', 'HARMONIC_EXCURSION', 'UNBALANCE', 'FREQUENCY_DEVIATION', 'FLICKER');

-- CreateEnum
CREATE TYPE "PqSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'INFO');

-- CreateEnum
CREATE TYPE "IticZone" AS ENUM ('NO_INTERRUPTION', 'NO_DAMAGE', 'PROHIBITED');

-- CreateTable
CREATE TABLE "pq_events" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "machineId" TEXT,
    "type" "PqEventType" NOT NULL,
    "severity" "PqSeverity" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER NOT NULL,
    "magnitudePct" DOUBLE PRECISION NOT NULL,
    "phase" TEXT,
    "nominalV" DOUBLE PRECISION NOT NULL,
    "minV" DOUBLE PRECISION,
    "maxV" DOUBLE PRECISION,
    "iticZone" "IticZone",
    "standard" TEXT NOT NULL DEFAULT 'EN 50160',
    "causedScrap" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pq_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harmonic_snapshots" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "phase" TEXT NOT NULL,
    "vHarmonics" DOUBLE PRECISION[],
    "iHarmonics" DOUBLE PRECISION[],
    "vThd" DOUBLE PRECISION NOT NULL,
    "iThd" DOUBLE PRECISION NOT NULL,
    "tdd" DOUBLE PRECISION,

    CONSTRAINT "harmonic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacitor_banks" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "totalKvar" DOUBLE PRECISION NOT NULL,
    "stepCount" INTEGER NOT NULL,
    "stepKvar" DOUBLE PRECISION NOT NULL,
    "ratedVoltage" DOUBLE PRECISION NOT NULL DEFAULT 400,
    "controller" TEXT,
    "pfSetpoint" DOUBLE PRECISION NOT NULL DEFAULT 0.96,
    "ctRatio" TEXT,
    "detunedFilter" BOOLEAN NOT NULL DEFAULT false,
    "detuningPct" DOUBLE PRECISION,
    "ratedStepCurrent" DOUBLE PRECISION,
    "measuredStepCurrent" DOUBLE PRECISION,
    "ratedCapacitanceUf" DOUBLE PRECISION,
    "measuredCapacitanceUf" DOUBLE PRECISION,
    "healthIndex" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "lastServiceAt" TIMESTAMP(3),
    "nextServiceAt" TIMESTAMP(3),

    CONSTRAINT "capacitor_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacitor_steps" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "kvar" DOUBLE PRECISION NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OFF',
    "switchingOps" INTEGER NOT NULL DEFAULT 0,
    "runHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capacitanceUf" DOUBLE PRECISION,
    "currentA" DOUBLE PRECISION,
    "healthPct" DOUBLE PRECISION NOT NULL DEFAULT 100,

    CONSTRAINT "capacitor_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "en50160_assessments" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "nominalV" DOUBLE PRECISION NOT NULL DEFAULT 230,
    "freqCompliance" DOUBLE PRECISION NOT NULL,
    "voltageCompliance" DOUBLE PRECISION NOT NULL,
    "unbalanceCompliance" DOUBLE PRECISION NOT NULL,
    "flickerCompliance" DOUBLE PRECISION,
    "thdA" DOUBLE PRECISION NOT NULL,
    "thdB" DOUBLE PRECISION NOT NULL,
    "thdC" DOUBLE PRECISION NOT NULL,
    "harmonicResults" JSONB NOT NULL,
    "overallPass" BOOLEAN NOT NULL,
    "failedItems" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "en50160_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pq_events_factoryId_startedAt_idx" ON "pq_events"("factoryId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "pq_events_meterId_startedAt_idx" ON "pq_events"("meterId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "harmonic_snapshots_meterId_time_idx" ON "harmonic_snapshots"("meterId", "time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "capacitor_banks_machineId_key" ON "capacitor_banks"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "capacitor_steps_bankId_stepNo_key" ON "capacitor_steps"("bankId", "stepNo");

-- CreateIndex
CREATE INDEX "en50160_assessments_meterId_weekStart_idx" ON "en50160_assessments"("meterId", "weekStart" DESC);

-- AddForeignKey
ALTER TABLE "pq_events" ADD CONSTRAINT "pq_events_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pq_events" ADD CONSTRAINT "pq_events_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pq_events" ADD CONSTRAINT "pq_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmonic_snapshots" ADD CONSTRAINT "harmonic_snapshots_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harmonic_snapshots" ADD CONSTRAINT "harmonic_snapshots_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacitor_banks" ADD CONSTRAINT "capacitor_banks_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacitor_banks" ADD CONSTRAINT "capacitor_banks_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacitor_steps" ADD CONSTRAINT "capacitor_steps_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "capacitor_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "en50160_assessments" ADD CONSTRAINT "en50160_assessments_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "en50160_assessments" ADD CONSTRAINT "en50160_assessments_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "energy_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
