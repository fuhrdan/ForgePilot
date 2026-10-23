import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function fingerprint(publicPem) { return sha256(Buffer.from(publicPem)).slice(0, 24); }

export async function ensureProvenanceKey(workspace) {
    const privatePath = resolveInside(workspace, ".forgepilot/keys/provenance-private.pem");
    const publicPath = resolveInside(workspace, ".forgepilot/keys/provenance-public.pem");
    try {
        const [privateKey, publicKey] = await Promise.all([fs.readFile(privatePath, "utf8"), fs.readFile(publicPath, "utf8")]);
        return { privatePath, publicPath, privateKey, publicKey, keyId: fingerprint(publicKey) };
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const pair = crypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
    await fs.mkdir(path.dirname(privatePath), { recursive: true });
    await fs.writeFile(privatePath, pair.privateKey, { encoding: "utf8", mode: 0o600 });
    await fs.writeFile(publicPath, pair.publicKey, "utf8");
    try { await fs.chmod(privatePath, 0o600); } catch { /* Windows may ignore POSIX mode */ }
    return { privatePath, publicPath, privateKey: pair.privateKey, publicKey: pair.publicKey, keyId: fingerprint(pair.publicKey) };
}

export async function signReport(workspace, reportPath) {
    const keys = await ensureProvenanceKey(workspace);
    const bytes = await fs.readFile(reportPath);
    const signature = crypto.sign(null, bytes, keys.privateKey).toString("base64");
    const provenance = {
        version: 1,
        algorithm: "Ed25519",
        createdAt: new Date().toISOString(),
        report: path.basename(reportPath),
        reportSha256: sha256(bytes),
        keyId: keys.keyId,
        publicKey: keys.publicKey,
        signature
    };
    const provenancePath = path.join(path.dirname(reportPath), "provenance.json");
    await fs.writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n", "utf8");
    return { ...provenance, provenancePath, publicPath: keys.publicPath };
}

export async function verifyReportProvenance(reportPath, { trustedPublicKeyPath = null } = {}) {
    const resolved = path.resolve(reportPath);
    const provenancePath = path.join(path.dirname(resolved), "provenance.json");
    const [bytes, provenanceRaw] = await Promise.all([fs.readFile(resolved), fs.readFile(provenancePath, "utf8")]);
    const provenance = JSON.parse(provenanceRaw);
    const actualSha256 = sha256(bytes);
    let publicKey = provenance.publicKey;
    let trusted = null;
    if (trustedPublicKeyPath) {
        publicKey = await fs.readFile(path.resolve(trustedPublicKeyPath), "utf8");
        trusted = fingerprint(publicKey) === provenance.keyId;
    }
    const signatureValid = crypto.verify(null, bytes, publicKey, Buffer.from(provenance.signature, "base64"));
    const hashValid = actualSha256 === provenance.reportSha256;
    return {
        passed: signatureValid && hashValid && (trusted !== false),
        signatureValid,
        hashValid,
        trustedKeyMatch: trusted,
        actualSha256,
        expectedSha256: provenance.reportSha256,
        keyId: provenance.keyId,
        provenancePath
    };
}
