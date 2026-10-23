import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typeBuffer.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
    return out;
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function channelsForColorType(colorType) {
    if (colorType === 0) return 1;
    if (colorType === 2) return 3;
    if (colorType === 4) return 2;
    if (colorType === 6) return 4;
    throw new Error(`Unsupported PNG color type ${colorType}; ForgePilot v0.7 supports grayscale, RGB, grayscale+alpha, and RGBA.`);
}

export async function decodePng(input) {
    const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Not a PNG file.");

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) throw new Error("Truncated PNG chunk.");
        const data = buffer.subarray(dataStart, dataEnd);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        offset = dataEnd + 4;
    }

    if (!width || !height) throw new Error("PNG is missing a valid IHDR chunk.");
    if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}; ForgePilot v0.7 supports 8-bit channels.`);
    if (interlace !== 0) throw new Error("Interlaced PNGs are not supported in ForgePilot v0.7.");

    const channels = channelsForColorType(colorType);
    const bytesPerPixel = channels;
    const stride = width * channels;
    const raw = await inflate(Buffer.concat(idat));
    const expected = height * (stride + 1);
    if (raw.length < expected) throw new Error("PNG decompressed data is truncated.");

    const scanlines = Buffer.alloc(height * stride);
    let sourceOffset = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[sourceOffset++];
        const rowStart = y * stride;
        for (let x = 0; x < stride; x++) {
            const encoded = raw[sourceOffset++];
            const left = x >= bytesPerPixel ? scanlines[rowStart + x - bytesPerPixel] : 0;
            const up = y > 0 ? scanlines[rowStart - stride + x] : 0;
            const upLeft = y > 0 && x >= bytesPerPixel ? scanlines[rowStart - stride + x - bytesPerPixel] : 0;
            let value;
            if (filter === 0) value = encoded;
            else if (filter === 1) value = (encoded + left) & 0xff;
            else if (filter === 2) value = (encoded + up) & 0xff;
            else if (filter === 3) value = (encoded + Math.floor((left + up) / 2)) & 0xff;
            else if (filter === 4) value = (encoded + paeth(left, up, upLeft)) & 0xff;
            else throw new Error(`Unsupported PNG filter ${filter}.`);
            scanlines[rowStart + x] = value;
        }
    }

    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0, p = 0; i < scanlines.length; i += channels, p += 4) {
        if (colorType === 0) {
            pixels[p] = scanlines[i]; pixels[p + 1] = scanlines[i]; pixels[p + 2] = scanlines[i]; pixels[p + 3] = 255;
        } else if (colorType === 2) {
            pixels[p] = scanlines[i]; pixels[p + 1] = scanlines[i + 1]; pixels[p + 2] = scanlines[i + 2]; pixels[p + 3] = 255;
        } else if (colorType === 4) {
            pixels[p] = scanlines[i]; pixels[p + 1] = scanlines[i]; pixels[p + 2] = scanlines[i]; pixels[p + 3] = scanlines[i + 1];
        } else {
            pixels[p] = scanlines[i]; pixels[p + 1] = scanlines[i + 1]; pixels[p + 2] = scanlines[i + 2]; pixels[p + 3] = scanlines[i + 3];
        }
    }

    return { width, height, pixels, bitDepth, colorType };
}

export async function encodePng({ width, height, pixels }) {
    width = Number(width);
    height = Number(height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error("PNG dimensions must be positive integers.");
    const rgba = Buffer.from(pixels);
    if (rgba.length !== width * height * 4) throw new Error(`Expected ${width * height * 4} RGBA bytes but received ${rgba.length}.`);

    const scanlines = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        const dst = y * (width * 4 + 1);
        scanlines[dst] = 0;
        rgba.copy(scanlines, dst + 1, y * width * 4, (y + 1) * width * 4);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const compressed = await deflate(scanlines, { level: 9 });
    return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

export async function writePng(filePath, image) {
    await fs.writeFile(filePath, await encodePng(image));
}
