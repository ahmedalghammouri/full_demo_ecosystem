"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyScaling = applyScaling;
exports.coerce = coerce;
/**
 * Apply linear scaling to a raw numeric register value: `raw * scaleFactor + offset`.
 * Null/undefined factors default to identity (×1, +0). Booleans pass through unchanged.
 */
function applyScaling(raw, opts) {
    if (raw === null || typeof raw === 'boolean')
        return raw;
    const factor = opts.scaleFactor ?? 1;
    const offset = opts.offset ?? 0;
    return raw * factor + offset;
}
/**
 * Coerce a (possibly scaled) value into the tag's declared data type so it is
 * stored consistently. Returns null when the value cannot be represented.
 */
function coerce(value, dataType) {
    if (value === null)
        return null;
    switch (dataType) {
        case 'BOOL':
            if (typeof value === 'boolean')
                return value;
            if (typeof value === 'number')
                return value !== 0;
            return value === 'true' || value === '1';
        case 'INT': {
            const n = Number(value);
            return Number.isFinite(n) ? Math.trunc(n) : null;
        }
        case 'FLOAT': {
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        }
        case 'TIMESTAMP':
        case 'STRING':
            return String(value);
        default:
            return value;
    }
}
//# sourceMappingURL=scaling.js.map