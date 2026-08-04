import assert from 'node:assert/strict';
import { PASSWORD_LIMITS, buildPasswordCharsets, generatePassword, secureRandomInt } from '../src/password-core.js';

let attempts = 0;
const rejectionSampler = array => { array[0] = attempts++ === 0 ? 0xffff_ffff : 5; };
assert.equal(secureRandomInt(10, rejectionSampler), 5);

let counter = 0;
const deterministic = array => { array[0] = counter++ % 100; };
const generated = generatePassword({ length: 12, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeSimilar: true }, deterministic);
assert.equal(generated.password.length, 12);
assert.match(generated.password, /[A-Z]/);
assert.match(generated.password, /[a-z]/);
assert.match(generated.password, /[0-9]/);
assert.match(generated.password, /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/);
assert.doesNotMatch(generated.password, /[0O1lI]/);
assert.deepEqual(buildPasswordCharsets({ lowercase: true, excludeSimilar: true }), ['abcdefghijkmnopqrstuvwxyz']);
assert.deepEqual(buildPasswordCharsets({ uppercase: true, lowercase: true, numbers: true, symbols: true, excludeSimilar: true }), [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*()_+-=[]{}|;:,.<>?~'
]);
assert.throws(() => generatePassword({ length: PASSWORD_LIMITS.minLength - 1, lowercase: true }, deterministic), RangeError);
assert.throws(() => generatePassword({ length: 4 }, deterministic));
const shortestComplete = generatePassword({ length: 4, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeSimilar: true }, deterministic);
assert.match(shortestComplete.password, /[A-Z]/);
assert.match(shortestComplete.password, /[a-z]/);
assert.match(shortestComplete.password, /[2-9]/);
assert.match(shortestComplete.password, /[!@#$%^&*()_+\-=[\]{}|;:,.<>?~]/);
assert.throws(() => secureRandomInt(0, deterministic), RangeError);
assert.throws(() => secureRandomInt(10, null), /Secure random generation is unavailable/);

console.log('Password core regression checks passed');
