import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

test("release metadata identifies the GitHub project and v0.19.0", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.version, "0.19.0");
    assert.equal(pkg.engines.node, ">=22");
    assert.equal(pkg.repository.url, "git+https://github.com/fuhrdan/ForgePilot.git");
    assert.equal(pkg.homepage, "https://github.com/fuhrdan/ForgePilot#readme");
});

test("repository includes standard open-source community and formatting files", () => {
    for (const rel of [
        "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "CODE_OF_CONDUCT.md",
        ".editorconfig", ".gitattributes",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/feature_request.yml",
        ".github/pull_request_template.md",
        "scripts/update-windows.ps1"
    ]) assert.equal(exists(rel), true, rel);
});

test("CI covers Linux and Windows and release automation is tag driven", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /ubuntu-latest/);
    assert.match(ci, /windows-latest/);
    assert.match(ci, /npm run test:ci/);
    assert.match(ci, /timeout-minutes:/);
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts["test:ci"], "node --test --test-force-exit --test-concurrency=4");
    const release = read(".github/workflows/release.yml");
    assert.match(release, /"v\*\.\*\.\*"/);
    assert.match(release, /gh release create/);
    assert.match(release, /package-release\.ps1/);
    assert.match(release, /npm run test:ci/);
});

test("README is a concise landing page with release install and universal prompt", () => {
    const text = read("README.md");
    assert.match(text, /ForgePilot-v0\.19\.0-windows\.zip/);
    assert.match(text, /one universal prompt/i);
    assert.match(text, /INSTALL_FORGEPILOT\.cmd/);
    assert.ok(text.split(/\r?\n/).length < 220, "README should stay a concise landing page");
});

test("release-readiness checker passes the repository tree", () => {
    const result = spawnSync(process.execPath, ["scripts/release-check.mjs"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS/);
    assert.match(result.stdout, /0\.19\.0/);
});

test("release packager includes one-click install assets and omits repository-only test workflow", () => {
    const ps = read("scripts/package-release.ps1");
    assert.match(ps, /INSTALL_FORGEPILOT\.cmd/);
    assert.match(ps, /RUN_FORGEPILOT\.cmd/);
    assert.match(ps, /Compress-Archive/);
    assert.doesNotMatch(ps, /foreach \(\$dir in @\([^)]*"test"/);
    assert.doesNotMatch(ps, /foreach \(\$dir in @\([^)]*"\.github"/);
});

test("version consistency is visible in CLI, installer, changelog, and release notes", () => {
    assert.match(read("src/cli.js"), /VERSION = "0\.19\.0"/);
    assert.match(read("INSTALL_FORGEPILOT.cmd"), /v0\.19\.0/);
    assert.match(read("scripts/install-one-click.ps1"), /-ne "0\.19\.0"/);
    assert.match(read("CHANGELOG.md"), /^## 0\.19\.0/m);
    assert.equal(exists("docs/releases/v0.19.0.md"), true);
});
