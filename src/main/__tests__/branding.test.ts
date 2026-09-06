import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const asset = (path: string): Buffer => readFileSync(join(process.cwd(), path));
const pngSize = (png: Buffer): number => {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  assert.equal(png[25], 6, 'RGBA, not a painted transparency checkerboard');
  return png.readUInt32BE(16);
};

describe('production desktop brand assets', () => {
  it('provides the transparent PNG artwork used in production', () => {
    assert.equal(pngSize(asset('resources/icon.png')), 512);
    assert.equal(pngSize(asset('build/icon.png')), 1024);
  });

  it('supplies the same multi-resolution Windows icon to the app and tray', () => {
    const ico = asset('build/icon.ico');
    assert.deepEqual(ico, asset('resources/icon.ico'));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    const sizes: number[] = [];
    for (let index = 0; index < ico.readUInt16LE(4); index++) {
      const entry = 6 + index * 16;
      const size = ico[entry] || 256;
      assert.equal(ico[entry + 1] || 256, size);
      assert.equal(ico.readUInt16LE(entry + 6), 32);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      assert.ok(offset + length <= ico.length);
      assert.equal(pngSize(ico.subarray(offset, offset + length)), size);
      sizes.push(size);
    }
    assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  });

  it('includes a complete macOS icon container', () => {
    const icns = asset('build/icon.icns');
    assert.equal(icns.toString('ascii', 0, 4), 'icns');
    assert.equal(icns.readUInt32BE(4), icns.length);
    let offset = 8;
    const types: string[] = [];
    while (offset < icns.length) {
      const length = icns.readUInt32BE(offset + 4);
      assert.ok(length > 8);
      types.push(icns.toString('ascii', offset, offset + 4));
      offset += length;
    }
    assert.equal(offset, icns.length);
    assert.ok(types.includes('ic08'));
    assert.ok(types.includes('ic09'));
    assert.ok(types.includes('ic10'));
  });
});
