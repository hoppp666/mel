import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.aistudio',
]);

function shouldExcludeRelPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('data/backups/') || norm === 'data/backups') return true;
  if (norm.startsWith('data/research_backups/') || norm === 'data/research_backups') return true;
  if (norm.startsWith('data/content_backups/') || norm === 'data/content_backups') return true;
  if (norm.startsWith('data/publishing_backups/') || norm === 'data/publishing_backups') return true;
  if (norm === 'data/pending_batch.json') return true;
  if (norm.startsWith('public/assets/aistudio')) return true;
  if (norm.endsWith('.tmp') || norm.endsWith('.log')) return true;
  if (norm.startsWith('.env') && norm !== '.env.example') return true;
  return false;
}

function collectFiles(rootDir: string, currentDir = rootDir): string[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    const rel = path.relative(rootDir, full);
    if (shouldExcludeRelPath(rel)) continue;
    if (entry.isDirectory()) {
      collected.push(...collectFiles(rootDir, full));
    } else if (entry.isFile()) {
      collected.push(rel);
    }
  }
  return collected;
}

export function buildProjectZipBuffer(rootDir = process.cwd()): {
  buffer: Buffer;
  fileCount: number;
} {
  const relFiles = collectFiles(rootDir).sort();
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const rel of relFiles) {
    const unixName = rel.replace(/\\/g, '/');
    const nameBuf = Buffer.from(unixName, 'utf8');
    const rawData = fs.readFileSync(path.join(rootDir, rel));
    const compressed = zlib.deflateRawSync(rawData);
    const useDeflate = compressed.length < rawData.length;
    const payload = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(rawData);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return {
    buffer: Buffer.concat([...localChunks, centralDir, eocd]),
    fileCount: relFiles.length,
  };
}
