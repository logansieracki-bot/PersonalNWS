export const APP_VERSION = '0.0.0-alpha';
export const APP_RELEASE_LABEL = 'Alpha';
export const BUILD_ID = import.meta.env?.VITE_BUILD_ID ?? 'local';

export const PRODUCTS = Object.freeze({
  REF: 1,
  VEL: 2,
  SW: 3,
  ZDR: 4,
  RHO: 5,
  PHI: 6,
});

export const PRODUCT_LABELS = Object.freeze({
  1: 'Reflectivity',
  2: 'Velocity',
  3: 'Spectrum Width',
  4: 'Differential Reflectivity',
  5: 'Correlation Coefficient',
  6: 'Differential Phase',
});

export const LEVEL2_ARCHIVE_BASE = 'https://unidata-nexrad-level2.s3.amazonaws.com';
export const ENGINE_API_VERSION = 4;
export const PSWP_VERSION = 1;
