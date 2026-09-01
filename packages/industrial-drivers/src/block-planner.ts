import type { RegisterType, TagBinding } from './types';

/** One tag's placement inside a block read. */
export interface BlockMember {
  tag: TagBinding;
  /** Offset (in registers/bits) of this tag's first word within the block window. */
  offset: number;
  /** Number of registers/bits this tag occupies (1 for bits, wordCount for registers). */
  span: number;
}

/** A contiguous window of one register type, read in a single Modbus request. */
export interface ReadBlock {
  registerType: RegisterType;
  start: number;
  count: number;
  members: BlockMember[];
}

/** Max registers per Modbus read (FC03/04 allow 125; bits allow far more, capped the same for safety). */
const MAX_BLOCK = 120;
/** Coalesce reads separated by a gap no larger than this (a few wasted regs beats an extra round-trip). */
const MAX_GAP = 8;

function spanOf(tag: TagBinding): number {
  const isBit = tag.registerType === 'COIL' || tag.registerType === 'DISCRETE';
  return isBit ? 1 : Math.max(1, tag.wordCount ?? 1);
}

/**
 * Group tag bindings into the minimum set of contiguous Modbus reads. Tags of
 * the same register type are sorted by address and merged into a window while
 * the window stays under {@link MAX_BLOCK} registers and the next tag starts
 * within {@link MAX_GAP} of the current window end. Each member records its
 * offset within the window so the caller can slice the response back out.
 *
 * Pure + deterministic — safe to unit-test and to recompute whenever a device's
 * tag set changes.
 */
export function planBlocks(tags: TagBinding[]): ReadBlock[] {
  const byType = new Map<RegisterType, TagBinding[]>();
  for (const t of tags) {
    (byType.get(t.registerType) ?? byType.set(t.registerType, []).get(t.registerType)!).push(t);
  }

  const blocks: ReadBlock[] = [];
  for (const [registerType, group] of byType) {
    const sorted = [...group].sort((a, b) => a.address - b.address);
    let current: ReadBlock | null = null;
    for (const tag of sorted) {
      const span = spanOf(tag);
      const end = tag.address + span; // exclusive
      if (
        current &&
        tag.address - current.start <= MAX_BLOCK - 1 &&
        end - current.start <= MAX_BLOCK &&
        tag.address <= current.start + current.count + MAX_GAP
      ) {
        current.count = Math.max(current.count, end - current.start);
        current.members.push({ tag, offset: tag.address - current.start, span });
      } else {
        current = {
          registerType,
          start: tag.address,
          count: span,
          members: [{ tag, offset: 0, span }],
        };
        blocks.push(current);
      }
    }
  }
  return blocks;
}
