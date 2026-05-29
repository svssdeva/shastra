import { expect, test } from 'bun:test';
import { UI_KIT_VERSION } from '../src/version.ts';

test('ui-kit version is published', () => {
  expect(UI_KIT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});
