import assert from 'node:assert/strict';
import {
  ICON_GEN_LIMITS,
  IconGenerationError,
  assertIconArchiveSize,
  assertIconSource,
  assertIconSourceDimensions,
  isSupportedIconSource
} from '../src/icon-gen-core.js';

assert.equal(isSupportedIconSource('logo.PNG'), true);
assert.equal(isSupportedIconSource('logo.gif'), false);
assertIconSource({ name: 'logo.webp', size: 1024 });
assert.throws(
  () => assertIconSource({ name: 'logo.gif', size: 1024 }),
  (error) => error instanceof IconGenerationError && error.code === 'unsupported_input'
);
assert.throws(
  () => assertIconSource({ name: 'logo.png', size: ICON_GEN_LIMITS.maxInputBytes + 1 }),
  (error) => error instanceof IconGenerationError && error.code === 'input_too_large'
);
assert.throws(
  () => assertIconSource({ name: 'empty.png', size: 0 }),
  (error) => error instanceof IconGenerationError && error.code === 'invalid_input_size'
);
assertIconSourceDimensions(1024, 1024);
assert.throws(
  () => assertIconSourceDimensions(5_000, 5_000),
  (error) => error instanceof IconGenerationError && error.code === 'too_many_pixels'
);
assertIconArchiveSize(1024);
assert.throws(
  () => assertIconArchiveSize(ICON_GEN_LIMITS.maxOutputBytes + 1),
  (error) => error instanceof IconGenerationError && error.code === 'archive_too_large'
);

console.log('Icon generator core regression checks passed');
