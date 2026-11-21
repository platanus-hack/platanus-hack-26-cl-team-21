import { crc32 } from "node:zlib";

// Minimal ZIP writer (stored entries, no compression) so a CSV export of both datasets is one
// download without adding a dependency. Enough for a handful of small text files: no ZIP64
// (each file and the archive must stay under 4 GiB), ASCII file names, a single timestamp.

export type ZipEntry = { name: string; data: Uint8Array };

function dosDateTime(date: Date) {
  // DOS time has 2-second resolution and no timezone; UTC is used.
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

export function createZip(entries: ZipEntry[], modifiedAt: Date): Buffer {
  const { time, day } = dosDateTime(modifiedAt);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const crc = crc32(entry.data);
    const size = entry.data.byteLength;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(10, 4); // version needed: 1.0 (stored)
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, Buffer.from(entry.data));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(10, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal and external attributes: all zero
    central.writeUInt32LE(offset, 42); // offset of the local header
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  return Buffer.concat([...locals, ...centrals, end]);
}
