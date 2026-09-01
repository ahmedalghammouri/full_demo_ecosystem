import type { ModbusDataType, WordOrder } from './types';

/** Pack 16-bit registers into a big-endian byte buffer, honouring word order. */
export function wordsToBuffer(words: number[], order: WordOrder = 'BIG'): Buffer {
  const ws = order === 'LITTLE' ? [...words].reverse() : words;
  const buf = Buffer.alloc(ws.length * 2);
  ws.forEach((w, i) => buf.writeUInt16BE(w & 0xffff, i * 2));
  return buf;
}

/**
 * Decode register words to a number per data type + width:
 *  - FLOAT: 2 words → IEEE-754 float32, 4 words → float64 (meters use float32)
 *  - INT:   1 word → uint16, 2 → uint32, 4 → uint64 (energy counters)
 */
export function decodeNumeric(
  words: number[],
  dataType: ModbusDataType,
  wordCount: number,
  order: WordOrder,
): number | null {
  if (!words.length) return null;
  const buf = wordsToBuffer(words, order);
  if (dataType === 'FLOAT') {
    if (wordCount >= 4) return buf.readDoubleBE(0);
    if (wordCount === 2) return buf.readFloatBE(0);
    return words[0];
  }
  // INT (unsigned — matches register-counter semantics)
  if (wordCount >= 4) return Number(buf.readBigUInt64BE(0));
  if (wordCount === 2) return buf.readUInt32BE(0);
  return words[0];
}
