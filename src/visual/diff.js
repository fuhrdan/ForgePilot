function normalizedRegion(image, region) {
    const x = Math.max(0, Math.floor(Number(region?.x ?? 0)));
    const y = Math.max(0, Math.floor(Number(region?.y ?? 0)));
    const width = Math.min(image.width - x, Math.max(0, Math.floor(Number(region?.width ?? image.width))));
    const height = Math.min(image.height - y, Math.max(0, Math.floor(Number(region?.height ?? image.height))));
    if (width <= 0 || height <= 0) throw new Error("Visual comparison region is empty or outside the image.");
    return { x, y, width, height };
}

function pixelAt(image, x, y) {
    const index = (y * image.width + x) * 4;
    return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2], image.pixels[index + 3]];
}

export function compareImages(actual, baseline, { channelThreshold = 0, region = null } = {}) {
    if (actual.width !== baseline.width || actual.height !== baseline.height) {
        return {
            comparable: false,
            reason: "dimension mismatch",
            actual: { width: actual.width, height: actual.height },
            baseline: { width: baseline.width, height: baseline.height },
            changedPixels: null,
            changedRatio: 1,
            meanDelta: 255,
            rmsDelta: 255,
            maxDelta: 255
        };
    }

    const area = normalizedRegion(actual, region);
    const threshold = Math.max(0, Number(channelThreshold ?? 0));
    let changedPixels = 0;
    let sum = 0;
    let sumSquares = 0;
    let maxDelta = 0;
    let samples = 0;

    for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
            const a = pixelAt(actual, x, y);
            const b = pixelAt(baseline, x, y);
            let pixelChanged = false;
            for (let c = 0; c < 4; c++) {
                const delta = Math.abs(a[c] - b[c]);
                sum += delta;
                sumSquares += delta * delta;
                maxDelta = Math.max(maxDelta, delta);
                samples++;
                if (delta > threshold) pixelChanged = true;
            }
            if (pixelChanged) changedPixels++;
        }
    }

    const totalPixels = area.width * area.height;
    return {
        comparable: true,
        region: area,
        totalPixels,
        changedPixels,
        changedRatio: totalPixels ? changedPixels / totalPixels : 0,
        meanDelta: samples ? sum / samples : 0,
        rmsDelta: samples ? Math.sqrt(sumSquares / samples) : 0,
        maxDelta
    };
}

export function probePixel(image, x, y) {
    x = Math.floor(Number(x));
    y = Math.floor(Number(y));
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error("Pixel probe is outside image bounds.");
    return pixelAt(image, x, y);
}

export function regionMean(image, region) {
    const area = normalizedRegion(image, region);
    const sums = [0, 0, 0, 0];
    let count = 0;
    for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
            const pixel = pixelAt(image, x, y);
            for (let c = 0; c < 4; c++) sums[c] += pixel[c];
            count++;
        }
    }
    return { region: area, rgba: sums.map((value) => value / count) };
}
