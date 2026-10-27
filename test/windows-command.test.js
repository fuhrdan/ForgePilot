import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpawnCommand } from "../src/core/command.js";

test("Windows npm shim resolves to npm-cli.js through node without enabling a shell", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const expectedCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    const resolved = resolveSpawnCommand("npm", ["test"], {
        platform: "win32",
        execPath,
        processEnv: {},
        existsSync: (candidate) => candidate === expectedCli
    });

    assert.equal(resolved.command, execPath);
    assert.deepEqual(resolved.args, [expectedCli, "test"]);
    assert.equal(resolved.displayCommand, "npm");
    assert.equal(resolved.shimResolved, true);
});

test("Windows npx shim resolves to npx-cli.js through node", () => {
    const execPath = "C:\\node\\node.exe";
    const npmExecPath = "C:\\node\\node_modules\\npm\\bin\\npm-cli.js";
    const expectedCli = "C:\\node\\node_modules\\npm\\bin\\npx-cli.js";
    const resolved = resolveSpawnCommand("npx", ["vite", "--version"], {
        platform: "win32",
        execPath,
        processEnv: { npm_execpath: npmExecPath },
        existsSync: (candidate) => candidate === expectedCli
    });

    assert.equal(resolved.command, execPath);
    assert.deepEqual(resolved.args, [expectedCli, "vite", "--version"]);
    assert.equal(resolved.displayCommand, "npx");
});

test("non-Windows commands remain unchanged", () => {
    const resolved = resolveSpawnCommand("npm", ["test"], {
        platform: "linux",
        execPath: "/usr/bin/node",
        processEnv: {},
        existsSync: () => true
    });
    assert.deepEqual(resolved, { command: "npm", args: ["test"] });
});

test("Windows npm falls back unchanged when no trusted JavaScript CLI can be found", () => {
    const resolved = resolveSpawnCommand("npm", ["test"], {
        platform: "win32",
        execPath: "C:\\unknown\\node.exe",
        processEnv: {},
        existsSync: () => false
    });
    assert.deepEqual(resolved, { command: "npm", args: ["test"] });
});
