import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as {
  compilerOptions?: { types?: string[] };
};
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  devDependencies?: Record<string, string>;
};
const createMapSource = readFileSync('src/map/create-map.ts', 'utf8');

describe('TypeScript map configuration', () => {
  it('loads GeoJSON ambient types used by the radar-station catalog', () => {
    expect(tsconfig.compilerOptions?.types).toContain('geojson');
    expect(packageJson.devDependencies?.['@types/geojson']).toBeDefined();
  });

  it('uses a MapLibre-compatible attribution configuration', () => {
    expect(createMapSource).not.toContain('attributionControl: true');
  });
});
