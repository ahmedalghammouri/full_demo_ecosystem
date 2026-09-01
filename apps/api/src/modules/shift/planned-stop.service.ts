import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { appliesOn, describeRule, occurrencesBetween } from '../../common/schedule-rule.util';
import { plantWallClockToUtc } from '../../common/plant-time.util';

/**
 * Planned stops — created by a person, scheduled explicitly, never assumed.
 *
 * What this replaces: two numbers on the shift template (`breakMinutes` and
 * `cleaningMinutes`, both defaulting to 30) and a generator that decided WHEN
 * they happened — the break at the midpoint of the shift, the cleaning at the
 * end. Those minutes were subtracted from planned production time, so they set
 * the OEE availability denominator for every machine in the plant, and nobody
 * had chosen any of them.
 *
 * The rule now: if it removes time from OEE, it is a row somebody created, with
 * a duration they entered, at a time they picked, on days they selected.
 *
 * Materialising is IDEMPOTENT per (template, target, day). Re-running never
 * duplicates, which matters because this is the kind of job that gets run twice
 * by a nervous operator.
 */
@Injectable()
export class PlannedStopService {
  private readonly logger = new Logger(PlannedStopService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) throw new BadRequestException('Factory context required');
    return factoryId;
  }

  // ── Schedule rules ────────────────────────────────────────────────────────

  async listScheduleRules(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const rows = await this.prisma.scheduleRule.findMany({
      where: { factoryId: fid },
      include: {
        _count: { select: { shiftTemplates: true, plannedStops: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // The summary is computed here rather than in the UI so the API, the audit
    // log and the screen can never describe the same rule differently.
    return rows.map((r) => ({ ...r, summary: describeRule(r) }));
  }

  async createScheduleRule(factoryId: string | null, dto: any) {
    const fid = this.requireFactory(factoryId);
    this.validateSchedule(dto);
    return this.prisma.scheduleRule.create({
      data: {
        factoryId: fid,
        name: String(dto.name ?? '').trim() || 'Schedule',
        daysOfWeek: dto.oneOffDate ? [] : (dto.daysOfWeek ?? []),
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.isPerpetual ? null : dto.endDate ? new Date(dto.endDate) : null,
        isPerpetual: !!dto.isPerpetual,
        oneOffDate: dto.oneOffDate ? new Date(dto.oneOffDate) : null,
        isActive: dto.isActive !== false,
      },
    });
  }

  async updateScheduleRule(factoryId: string | null, id: string, dto: any) {
    const fid = this.requireFactory(factoryId);
    const existing = await this.prisma.scheduleRule.findFirst({ where: { id, factoryId: fid } });
    if (!existing) throw new NotFoundException('Schedule rule not found');
    this.validateSchedule({ ...existing, ...dto });
    return this.prisma.scheduleRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: String(dto.name).trim() }),
        ...(dto.daysOfWeek !== undefined && { daysOfWeek: dto.daysOfWeek }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.isPerpetual !== undefined && { isPerpetual: !!dto.isPerpetual, ...(dto.isPerpetual && { endDate: null }) }),
        ...(dto.oneOffDate !== undefined && { oneOffDate: dto.oneOffDate ? new Date(dto.oneOffDate) : null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteScheduleRule(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const inUse = await this.prisma.shiftTemplate.count({ where: { scheduleRuleId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `${inUse} shift template(s) still use this schedule. Point them elsewhere first — ` +
        'deleting it silently would leave those shifts with no recurrence at all.',
      );
    }
    const existing = await this.prisma.scheduleRule.findFirst({ where: { id, factoryId: fid }, select: { id: true } });
    if (!existing) throw new NotFoundException('Schedule rule not found');
    await this.prisma.scheduleRule.delete({ where: { id } });
  }

  /**
   * A schedule that can never fire is a configuration error, not a valid state.
   * Caught at save time so nobody has to work out later why a shift never ran.
   */
  private validateSchedule(dto: any) {
    if (dto.oneOffDate) return; // a dated occurrence needs nothing else
    const days = Array.isArray(dto.daysOfWeek) ? dto.daysOfWeek : [];
    if (days.length === 0) {
      throw new BadRequestException(
        'Select at least one weekday, or set a one-off date. A rule with no days never runs.',
      );
    }
    if (!dto.isPerpetual && dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('The end date is before the start date.');
    }
  }

  // ── Planned stop templates ────────────────────────────────────────────────

  async listTemplates(factoryId: string | null, shiftTemplateId?: string) {
    const fid = this.requireFactory(factoryId);
    return this.prisma.plannedStopTemplate.findMany({
      where: { factoryId: fid, ...(shiftTemplateId ? { shiftTemplateId } : {}) },
      include: {
        cause: { select: { id: true, code: true, name: true } },
        shiftTemplate: { select: { id: true, code: true, name: true, startTime: true } },
        scheduleRule: true,
        targets: {
          include: {
            line: { select: { id: true, code: true, name: true } },
            machine: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ shiftTemplateId: 'asc' }, { startOffsetMin: 'asc' }],
    });
  }

  async createTemplate(factoryId: string | null, dto: any) {
    const fid = this.requireFactory(factoryId);
    this.validateTemplate(dto);
    await this.assertParentExists(fid, dto);

    return this.prisma.plannedStopTemplate.create({
      data: {
        factoryId: fid,
        code: String(dto.code).trim(),
        name: String(dto.name).trim(),
        nameAr: dto.nameAr ?? null,
        durationMinutes: Number(dto.durationMinutes),
        scope: (dto.scope ?? 'LINE') as never,
        causeId: dto.causeId ?? null,
        category: (dto.category ?? 'PLANNED_BREAK') as never,
        shiftTemplateId: dto.shiftTemplateId ?? null,
        // Minutes after the SHIFT starts, and only that. It used to double as
        // "minutes after midnight" for a standalone stop, so one column carried
        // two meanings and a stop with neither set landed at 00:00 without
        // anyone choosing it. A standalone stop now states its own clock time.
        startOffsetMin: Number(dto.startOffsetMin ?? 0),
        startTimeLocal: dto.shiftTemplateId ? null : (dto.startTimeLocal ?? null),
        scheduleRuleId: dto.shiftTemplateId ? null : (dto.scheduleRuleId ?? null),
        description: dto.description ?? null,
        isActive: dto.isActive !== false,
        targets: {
          create: (dto.targets ?? []).map((t: any) => ({
            lineId: t.lineId ?? null,
            machineId: t.machineId ?? null,
          })),
        },
      },
      include: { targets: true },
    });
  }

  async updateTemplate(factoryId: string | null, id: string, dto: any) {
    const fid = this.requireFactory(factoryId);
    const existing = await this.prisma.plannedStopTemplate.findFirst({ where: { id, factoryId: fid } });
    if (!existing) throw new NotFoundException('Planned stop not found');
    this.validateTemplate({ ...existing, ...dto }, true);
    await this.assertParentExists(fid, dto);

    // Targets are replaced wholesale: a partial update would leave a stop
    // attached to a machine the user just removed from the list.
    if (dto.targets !== undefined) {
      await this.prisma.plannedStopTarget.deleteMany({ where: { templateId: id } });
      if (dto.targets.length) {
        await this.prisma.plannedStopTarget.createMany({
          data: dto.targets.map((t: any) => ({
            templateId: id, lineId: t.lineId ?? null, machineId: t.machineId ?? null,
          })),
        });
      }
    }

    return this.prisma.plannedStopTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: String(dto.name).trim() }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: Number(dto.durationMinutes) }),
        ...(dto.scope !== undefined && { scope: dto.scope as never }),
        ...(dto.causeId !== undefined && { causeId: dto.causeId }),
        ...(dto.category !== undefined && { category: dto.category as never }),
        ...(dto.startOffsetMin !== undefined && { startOffsetMin: Number(dto.startOffsetMin) }),
        ...(dto.startTimeLocal !== undefined && { startTimeLocal: dto.startTimeLocal || null }),
        ...(dto.scheduleRuleId !== undefined && { scheduleRuleId: dto.scheduleRuleId }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { targets: true },
    });
  }

  async deleteTemplate(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const existing = await this.prisma.plannedStopTemplate.findFirst({ where: { id, factoryId: fid }, select: { id: true } });
    if (!existing) throw new NotFoundException('Planned stop not found');
    // Events already materialised are left alone. Deleting a template must not
    // rewrite a month somebody has already reported on.
    await this.prisma.plannedStopTemplate.delete({ where: { id } });
  }

  /**
   * The shift or schedule this stop hangs off must actually exist, and belong to
   * this factory.
   *
   * Without the check a bad id reaches the database and comes back as a foreign
   * key violation — a 500 that tells the user their server is broken when what
   * they did was point at something that is not there. It also closes a
   * cross-tenant hole: an id from another factory would otherwise be accepted.
   */
  private async assertParentExists(factoryId: string, dto: any) {
    if (dto.shiftTemplateId) {
      const shift = await this.prisma.shiftTemplate.findFirst({
        where: { id: dto.shiftTemplateId, factoryId },
        select: { id: true },
      });
      if (!shift) throw new NotFoundException('That shift template does not exist in this factory');
    }
    if (dto.scheduleRuleId) {
      const rule = await this.prisma.scheduleRule.findFirst({
        where: { id: dto.scheduleRuleId, factoryId },
        select: { id: true },
      });
      if (!rule) throw new NotFoundException('That schedule does not exist in this factory');
    }
  }

  private validateTemplate(dto: any, isUpdate = false) {
    if (!isUpdate && (!dto.code || !dto.name)) {
      throw new BadRequestException('A code and a name are required');
    }
    const mins = Number(dto.durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      throw new BadRequestException(
        'Enter how many minutes the stop lasts. An unstated duration is exactly what this replaces.',
      );
    }
    // Belonging to a shift and to a standalone schedule at once is ambiguous —
    // it would be materialised twice and counted twice against availability.
    if (dto.shiftTemplateId && dto.scheduleRuleId) {
      throw new BadRequestException(
        'A stop is either inside a shift or on its own schedule, not both.',
      );
    }
    if (!dto.shiftTemplateId && !dto.scheduleRuleId) {
      throw new BadRequestException(
        'Attach the stop to a shift template, or give it its own schedule.',
      );
    }
    // A stop on its own schedule has no shift to be measured from, so without a
    // clock time there is nowhere on the day to put it. Refused at the door
    // rather than accepted and then silently skipped at generation — a stop
    // saved successfully and producing nothing is the worse of the two.
    if (!dto.shiftTemplateId) {
      const t = dto.startTimeLocal;
      if (!t || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t))) {
        throw new BadRequestException(
          'A stop on its own schedule needs a start time (HH:MM) — there is no shift to count from.',
        );
      }
    }
  }

  // ── Materialising ─────────────────────────────────────────────────────────

  /**
   * Turn templates into real downtime events across a date range.
   *
   * Replaces `generatePlannedDowntime`, which read `breakMinutes` /
   * `cleaningMinutes` and invented the times. Here every event's start comes
   * from a number the user entered.
   */
  async materialise(
    factoryId: string | null,
    dto: { dateFrom: string; dateTo?: string; templateIds?: string[] },
  ) {
    const fid = this.requireFactory(factoryId);
    const from = this.localDate(dto.dateFrom);
    const to = dto.dateTo ? this.localDate(dto.dateTo) : from;
    if (!from || !to) throw new BadRequestException('dateFrom (and optionally dateTo) are required as YYYY-MM-DD');

    // Filter the list rather than trusting its length. A caller that sends
    // [null] — a client whose own lookup returned nothing — otherwise reaches
    // Prisma as `id: { in: [null] }` and comes back as a 500, which reads as a
    // broken server rather than a bad request.
    const wanted = (dto.templateIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (dto.templateIds?.length && wanted.length === 0) {
      throw new BadRequestException('templateIds contained no valid ids');
    }

    const templates = await this.prisma.plannedStopTemplate.findMany({
      where: {
        factoryId: fid, isActive: true,
        ...(wanted.length ? { id: { in: wanted } } : {}),
      },
      include: {
        shiftTemplate: { include: { scheduleRule: true } },
        scheduleRule: true,
        targets: true,
      },
    });
    if (templates.length === 0) {
      throw new BadRequestException(
        'No active planned stops to schedule. Create one first — the system no longer invents breaks.',
      );
    }

    let created = 0;
    let skipped = 0;
    const noSchedule: string[] = [];

    for (const tpl of templates) {
      // A stop inside a shift inherits the shift's recurrence; a standalone one
      // carries its own. Either way the days come from a rule, never from code.
      const rule = tpl.shiftTemplateId
        ? (tpl.shiftTemplate?.scheduleRule ?? legacyDaysRule(tpl.shiftTemplate))
        : tpl.scheduleRule;
      if (!rule) { noSchedule.push(tpl.code); continue; }

      const targets = await this.resolveTargets(fid, tpl);
      if (targets.length === 0) { noSchedule.push(tpl.code); continue; }

      let placeable = true;
      for (const day of occurrencesBetween(rule, from, to)) {
        const start = this.startOf(tpl, day);
        if (!start) { placeable = false; break; }
        const end = new Date(start.getTime() + tpl.durationMinutes * 60_000);

        for (const machineId of targets) {
          // Idempotent by (machine, category, exact start). Re-running the same
          // range is a no-op rather than a second subtraction from availability.
          const exists = await this.prisma.downtimeEvent.findFirst({
            where: { machineId, category: tpl.category, startTime: start, isPlanned: true },
            select: { id: true },
          });
          if (exists) { skipped++; continue; }

          await this.prisma.downtimeEvent.create({
            data: {
              factoryId: fid,
              machineId,
              causeId: tpl.causeId,
              category: tpl.category,
              reasonCode: 'PLANNED_MAINTENANCE' as never,
              startTime: start,
              endTime: end,
              durationMinutes: tpl.durationMinutes,
              isPlanned: true,
              affectsOEE: false,
              notes: `Planned stop: ${tpl.name} (${tpl.code})`,
            },
          });
          created++;
        }
      }
      if (!placeable) noSchedule.push(tpl.code);
    }

    return {
      created,
      skipped,
      templates: templates.length,
      // Named rather than silently dropped: a stop with no schedule or no target
      // produces nothing, and the user needs to know which one.
      notScheduled: noSchedule,
    };
  }

  /**
   * Start time of one occurrence: shift start + offset, or midnight + offset.
   *
   * The wall-clock time is PLANT-local and must be converted explicitly. Using
   * `setHours` here would silently take the SERVER's timezone instead, which
   * happens to be right only while the container and the plant agree — and this
   * codebase has already been bitten by exactly that once: shift instances and
   * every break derived from them sat three hours late until
   * `plantWallClockToUtc` was introduced. Same helper, same reason.
   */
  private startOf(
    tpl: {
      shiftTemplate?: { startTime: string } | null;
      startOffsetMin: number | null;
      startTimeLocal?: string | null;
    },
    day: Date,
  ): Date | null {
    // A stop inside a shift is placed from that shift's start. A standalone one
    // is placed by its own wall-clock time. There is no third case, and there
    // is deliberately no fallback: this used to read `?? '00:00'`, so a stop
    // with no shift was materialised at MIDNIGHT — a downtime event at a time
    // nobody chose, on every machine it targeted. Returning null instead sends
    // it to `notScheduled`, where the user is told about it.
    const base = tpl.shiftTemplate?.startTime ?? tpl.startTimeLocal ?? null;
    if (!base || !/^\d{1,2}:\d{2}$/.test(base)) return null;
    const wallClock = plantWallClockToUtc(day, base);
    // The offset counts from a SHIFT start. A standalone stop's own time is
    // already the answer, so adding an offset to it would move it twice.
    const offset = tpl.shiftTemplate ? (tpl.startOffsetMin ?? 0) : 0;
    return new Date(wallClock.getTime() + offset * 60_000);
  }

  /**
   * Which machines this stop actually applies to.
   *
   * The old generator attached every planned stop to every active machine,
   * which invented downtime for equipment nobody had touched. Scope is now
   * explicit, and a scope with no targets produces nothing rather than
   * defaulting to everything.
   */
  private async resolveTargets(
    factoryId: string,
    tpl: { scope: string; targets: Array<{ lineId: string | null; machineId: string | null }> },
  ): Promise<string[]> {
    if (tpl.scope === 'FACTORY') {
      const all = await this.prisma.machine.findMany({
        where: { factoryId, isActive: true, archivedAt: null },
        select: { id: true },
      });
      return all.map((m) => m.id);
    }

    const machineIds = tpl.targets.map((t) => t.machineId).filter((v): v is string => !!v);
    const lineIds = tpl.targets.map((t) => t.lineId).filter((v): v is string => !!v);

    if (lineIds.length) {
      const onLines = await this.prisma.machine.findMany({
        where: { factoryId, isActive: true, archivedAt: null, lineId: { in: lineIds } },
        select: { id: true },
      });
      machineIds.push(...onLines.map((m) => m.id));
    }
    return [...new Set(machineIds)];
  }

  /** YYYY-MM-DD as a plant-local calendar day. */
  private localDate(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /**
   * Planned production minutes for a shift template on a given day.
   *
   * Was `shiftDurationHours × 60 − breakMinutes − cleaningMinutes`, both of
   * those being invented defaults. Now it is the shift duration minus the stops
   * that were actually scheduled inside it — so the availability denominator is
   * traceable to rows a person created.
   */
  async plannedProductionMinutes(shiftTemplateId: string, on: Date): Promise<number> {
    const tpl = await this.prisma.shiftTemplate.findUnique({
      where: { id: shiftTemplateId },
      include: { plannedStops: { where: { isActive: true }, include: { scheduleRule: true } } },
    });
    if (!tpl) return 0;

    const total = tpl.shiftDurationHours * 60;
    let stops = 0;
    for (const s of tpl.plannedStops) {
      // A stop with its own rule only counts on the days that rule fires.
      if (s.scheduleRule && !appliesOn(s.scheduleRule, on)) continue;
      stops += s.durationMinutes;
    }
    return Math.max(0, total - stops);
  }
}

/**
 * A shift's recurrence when it still lives in the legacy `days` column.
 *
 * `ScheduleRule` replaced `ShiftTemplate.days`, and the schema says in as many
 * words that `days` is "retained only so existing rows keep working until they
 * are migrated". This code did not keep that promise: it read `scheduleRule`
 * and nothing else, so a shift that had never been migrated looked like a shift
 * with NO recurrence — and every planned stop attached to it produced zero
 * events while reporting success.
 *
 * That is how a break configured correctly, on a shift configured correctly,
 * showed up nowhere at all. On this plant both shifts carried
 * `days = [6,0,1,2,3,4]` — the real working week — and `scheduleRuleId = null`.
 *
 * The migration still needs to run, and now does on every boot. This exists so
 * the answer does not depend on whether it has.
 */
function legacyDaysRule(
  shift: { days?: unknown } | null | undefined,
): { daysOfWeek: unknown; startDate: null; endDate: null; isPerpetual: true; oneOffDate: null; isActive: true } | null {
  const days = shift?.days;
  const list = Array.isArray(days) ? days : null;
  if (!list || list.length === 0) return null;
  return { daysOfWeek: list, startDate: null, endDate: null, isPerpetual: true, oneOffDate: null, isActive: true };
}
