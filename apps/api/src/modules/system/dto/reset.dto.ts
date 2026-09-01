import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export type ResetScope =
  | 'production' | 'timeseries' | 'energy'
  | 'quality' | 'maintenance' | 'downtime' | 'plannedDowntime' | 'alarms'
  | 'inventory' | 'shifts' | 'notifications';

export class ResetSystemDto {
  /**
   * Which subsystem to reset:
   *  - 'production'  → deletes all production orders / work orders / job orders
   *                    and their dependent records from PostgreSQL.
   *  - 'timeseries'  → wipes the InfluxDB historian bucket only.
   *  - 'energy'      → deletes energy meter readings, period summaries and the
   *                    derived per-WO / per-machine ratios from PostgreSQL.
   *                    Meters, tariffs and device bindings are preserved.
   */
  @IsIn([
    'production', 'timeseries', 'energy',
    'quality', 'maintenance', 'downtime', 'plannedDowntime', 'alarms',
    'inventory', 'shifts', 'notifications',
  ])
  scope!: ResetScope;

  /**
   * Window for `plannedDowntime`, as plant-local instants.
   *
   * The only scope that takes one, and it takes one because planned downtime is
   * the only history a plant routinely needs to correct in PART. A schedule
   * entered wrong for two days should not cost the quarter around it, and the
   * existing all-or-nothing resets have no way to say that.
   *
   * Both bounds are REQUIRED when this scope is used. An optional window on a
   * delete is a footgun: omit it by accident and the safe-looking call becomes
   * the destructive one.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** When scope='production', also wipe the InfluxDB historian in the same run. */
  @IsOptional()
  @IsBoolean()
  wipeTimeseries?: boolean;

  /** The owner's current password — re-verified server-side before anything is deleted. */
  @IsString()
  @MinLength(1)
  password!: string;

  /** Safety phrase the operator must type exactly. Expected value: "RESET". */
  @IsString()
  confirmation!: string;
}
