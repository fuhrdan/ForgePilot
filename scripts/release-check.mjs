#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
const failures = [];

function requireFile(rel) {
  if (!exists(rel)) failures.push(`missing required file: ${rel}`);
}

[
  "README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md",
  "INSTALL_FORGEPILOT.cmd", "RUN_FORGEPILOT.cmd",
  ".github/workflows/ci.yml", ".github/workflows/release.yml",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  "docs/INSTALLATION.md", "docs/RELEASING.md", `docs/releases/v${version}.md`,
  "scripts/package-release.ps1", "scripts/update-windows.ps1"
].forEach(requireFile);

if (pkg.engines?.node !== ">=22") failures.push("package.json engines.node must be >=22");
if (pkg.repository?.url !== "git+https://github.com/fuhrdan/ForgePilot.git") failures.push("package.json repository URL is incorrect");

const installCmd = read("INSTALL_FORGEPILOT.cmd");
if (!installCmd.includes(`v${version}`)) failures.push("INSTALL_FORGEPILOT.cmd version does not match package.json");

const installer = read("scripts/install-one-click.ps1");
if (!installer.includes(`-ne "${version}"`)) failures.push("install-one-click.ps1 installed-version check does not match package.json");

const readme = read("README.md");
if (!readme.includes(`ForgePilot-v${version}-windows.zip`)) failures.push("README quick-start release asset does not match package version");
if (!readme.includes("one universal prompt")) failures.push("README must keep the universal-prompt product positioning");

const changelog = read("CHANGELOG.md");
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog)) failures.push(`CHANGELOG.md is missing ${version}`);

for (const junk of [".forgepilot", "node_modules"]) {
  if (exists(junk)) failures.push(`runtime/build directory must not be present in repository root: ${junk}`);
}

if (failures.length) {
  console.error("ForgePilot release-readiness check: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ForgePilot release-readiness check: PASS");
console.log(`Version: ${version}`);
console.log(`Release asset: ForgePilot-v${version}-windows.zip`);
