#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = new Set(['start', 'runner', 'setup', 'timeout']);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entry = process.argv[process.argv.indexOf('--entry') + 1];
  if (!entries.has(entry)) throw new Error('usage: package-lambda.mjs --entry start|runner|setup|timeout');
  const output = path.join(root, 'dist', 'lambda', `${entry}.zip`);
  const built = buildSync({ entryPoints: [path.join(root, 'src', 'handlers', `${entry}.ts`)], bundle: true, platform: 'node', target: 'node24', format: 'esm', minify: false, sourcemap: false, write: false, logLevel: 'silent', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  if (built.outputFiles.length !== 1) throw new Error('expected one bundle output');
  const zip = createDeterministicZip([{ name: 'index.mjs', content: built.outputFiles[0].contents }], output);
  fs.writeFileSync(`${output}.sha256`, `${crypto.createHash('sha256').update(zip).digest('hex')}  ${path.basename(output)}\n`);
  console.log(`${output}\n${output}.sha256`);
}

export function createDeterministicZip(files, outputPath) {
  const contents = []; const central = []; let offset = 0;
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (/node_modules|\.env|\.pem|\.key|\.secret|\.aws|credentials|token/i.test(file.name)) throw new Error(`refusing sensitive path: ${file.name}`);
    const name = Buffer.from(file.name); const source = Buffer.from(file.content); const compressed = zlib.deflateRawSync(source, { level: 9 }); const crc = crc32(source);
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x0021, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    const header = Buffer.alloc(46 + name.length); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(0, 12); header.writeUInt16LE(0x0021, 14); header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(source.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(0x81a40000, 38); header.writeUInt32LE(offset, 42); name.copy(header, 46);
    contents.push(local, compressed); central.push(header); offset += local.length + compressed.length;
  }
  const centralSize = central.reduce((size, item) => size + item.length, 0); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...contents, ...central, end]); fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, zip); return zip;
}
function crc32(buffer) { let crc = ~0; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (~crc) >>> 0; }
