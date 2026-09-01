-- ============================================================
-- Industry360° — Operational Reset (keep master/config, wipe operational + generated)
-- Chosen scope: "إعادة ضبط تشغيلية". Keeps factories, areas, lines, machines,
-- SKUs/products, raw materials, spare parts, recipes/processes/BOMs, energy
-- meters + tariffs, users, storage locations, shift templates, quality/PM plans,
-- alarm/downtime-cause/failure-mode definitions, dashboards, attachments, audit log.
-- Deletes ALL transactional + generated/synthetic data so dashboards show only
-- real data entered from now on.
-- Irreversible. Run against the industry360 database.
-- ============================================================
TRUNCATE TABLE
  -- Production execution
  production_orders, work_orders, job_orders, job_order_materials,
  batch_records, genealogy_links, material_consumptions, material_lots,
  production_events, scrap_logs, reschedule_requests, shift_instances,
  -- OEE / machine state / downtime (generated analytics)
  oee_records, machine_state_records, downtime_events, machine_current_status,
  -- Energy (generated readings/summaries)
  energy_readings, energy_summaries, energy_wo_summaries,
  -- Quality (operational results)
  inspection_results, ncrs, capas, capa_actions, spc_measurements,
  -- Inventory movements / requests / transfers / FG lots
  stock_movements, material_requests, storage_transfers, finished_goods_lots,
  -- Traceability + notifications + live IoT values
  trace_events, traceability_links, notifications, tag_current_values,
  -- Maintenance work orders (operational)
  maintenance_wos, maint_wo_spare_parts, maintenance_wo_failure_modes,
  alarm_events
RESTART IDENTITY CASCADE;
