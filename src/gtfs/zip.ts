const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export async function unzip(bytes: Uint8Array, limits: ZipLimits): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > limits.maxEntries || centralOffset + centralSize > bytes.byteLength) throw new Error("unsafe ZIP directory limits");
  const output = new Map<string, Uint8Array>();
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index++) {
    requireRange(bytes, offset, 46);
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error("invalid ZIP central directory");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    requireRange(bytes, offset + 46, nameLength + extraLength + commentLength);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    validateName(name);
    if (flags & 1) throw new Error("encrypted ZIP entries are unsupported");
    if (uncompressedSize > limits.maxEntryBytes || total + uncompressedSize > limits.maxTotalBytes) throw new Error("unsafe ZIP expansion limits");
    const data = await extractEntry(bytes, view, localOffset, compressedSize, uncompressedSize, method);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP CRC mismatch for ${name}`);
    output.set(name, data);
    total += data.byteLength;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

function findEocd(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("ZIP end-of-directory record is missing");
}

async function extractEntry(bytes: Uint8Array, view: DataView, offset: number, compressedSize: number, expectedSize: number, method: number): Promise<Uint8Array> {
  requireRange(bytes, offset, 30);
  if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) throw new Error("invalid ZIP local header");
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  requireRange(bytes, start, compressedSize);
  const compressed = bytes.subarray(start, start + compressedSize);
  if (method === 0) return new Uint8Array(compressed);
  if (method !== 8) throw new Error(`unsupported ZIP compression method ${method}`);
  const compressedBuffer = compressed.slice().buffer as ArrayBuffer;
  const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (result.byteLength !== expectedSize) throw new Error("ZIP entry size mismatch");
  return result;
}

function validateName(name: string): void {
  if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error("unsafe ZIP entry name");
}

function requireRange(bytes: Uint8Array, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) throw new Error("truncated ZIP file");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
