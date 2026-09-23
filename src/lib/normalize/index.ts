/**
 * The normalization module (DEDUP-04, D-12). TypeScript is the single authoritative
 * normalizer: every normalized column is written from here, and SQL never normalizes.
 */
export * from './name';
export * from './phone';
export * from './address';
