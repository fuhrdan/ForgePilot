import fs from "node:fs/promises";
import path from "node:path";

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
    return { time, date: day };
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }

export async function writeZip(outputPath, entries = []) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const name = String(entry.name).replaceAll("\\", "/").replace(/^\/+/, "");
        if (!name || name.includes("../")) throw new Error(`Unsafe ZIP entry name: ${name}`);
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
        const nameBuf = Buffer.from(name, "utf8");
        const crc = crc32(data);
        const stamp = dosDateTime(entry.mtime ?? new Date());
        const localHeader = Buffer.concat([
            u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
            u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf
        ]);
        local.push(localHeader, data);
        const centralHeader = Buffer.concat([
            u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
            u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
            u32(0), u32(offset), nameBuf
        ]);
        central.push(centralHeader);
        offset += localHeader.length + data.length;
    }
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralSize), u32(offset), u16(0)
    ]);
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, Buffer.concat([...local, ...central, end]));
    return outputPath;
}
