import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/repository/scanner.js";
import { detectProjects } from "../src/repository/detector.js";
import { buildRepositoryContext } from "../src/repository/context.js";
import { captureGitBaseline, summarizeGitDiff } from "../src/repository/git-diff.js";
import { verifyPlan } from "../src/verification/verifier.js";
import { runCommand } from "../src/core/command.js";

async function tempWorkspace(prefix = "forgepilot-repo-") {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function git(workspace, args) {
    const result = await runCommand({ command: "git", args, cwd: workspace, timeoutMs: 10000 });
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    return result;
}

async function initRepo(workspace) {
    await git(workspace, ["init"]);
    await git(workspace, ["config", "user.email", "forgepilot@example.invalid"]);
    await git(workspace, ["config", "user.name", "ForgePilot Tests"]);
}

test("filesystem scanner honors root .gitignore and built-in excludes", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "node_modules"));
    await fs.writeFile(path.join(workspace, ".gitignore"), "ignored.txt\nlogs/\n", "utf8");
    await fs.writeFile(path.join(workspace, "ignored.txt"), "no", "utf8");
    await fs.writeFile(path.join(workspace, "keep.js"), "yes", "utf8");
    await fs.writeFile(path.join(workspace, "node_modules", "skip.js"), "no", "utf8");
    await fs.mkdir(path.join(workspace, "logs"));
    await fs.writeFile(path.join(workspace, "logs", "debug.log"), "no", "utf8");

    const scan = await scanRepository(workspace);
    assert.equal(scan.source, "filesystem");
    assert.ok(scan.files.includes("keep.js"));
    assert.ok(!scan.files.includes("ignored.txt"));
    assert.ok(!scan.files.some((file) => file.startsWith("node_modules/")));
    assert.ok(!scan.files.some((file) => file.startsWith("logs/")));
});

test("Git-backed scanner delegates ignore rules to Git", async () => {
    const workspace = await tempWorkspace();
    await initRepo(workspace);
    await fs.writeFile(path.join(workspace, ".gitignore"), "secret.tmp\n", "utf8");
    await fs.writeFile(path.join(workspace, "tracked.js"), "console.log('x');\n", "utf8");
    await fs.writeFile(path.join(workspace, "secret.tmp"), "ignore", "utf8");
    await fs.mkdir(path.join(workspace, ".forgepilot"));
    await fs.writeFile(path.join(workspace, ".forgepilot", "state.json"), "{}", "utf8");
    await git(workspace, ["add", ".gitignore", "tracked.js"]);

    const scan = await scanRepository(workspace);
    assert.equal(scan.source, "git");
    assert.ok(scan.files.includes("tracked.js"));
    assert.ok(!scan.files.includes("secret.tmp"));
    assert.ok(!scan.files.some((file) => file.startsWith(".forgepilot/")));
});

test("project detector identifies Node TypeScript frameworks and commands", async () => {
    const workspace = await tempWorkspace();
    const pkg = {
        name: "sample",
        scripts: { test: "node --test", build: "tsc", lint: "eslint ." },
        dependencies: { react: "1.0.0" },
        devDependencies: { typescript: "1.0.0", vite: "1.0.0" }
    };
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify(pkg), "utf8");
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "src", "main.ts"), "export const x = 1;", "utf8");

    const projects = await detectProjects(workspace, ["package.json", "src/main.ts"]);
    const node = projects.find((project) => project.ecosystem === "node");
    assert.ok(node);
    assert.equal(node.language, "TypeScript/JavaScript");
    assert.ok(node.frameworks.includes("React"));
    assert.ok(node.frameworks.includes("Vite"));
    assert.ok(node.commands.some((command) => command.kind === "test"));
    assert.ok(node.commands.some((command) => command.kind === "build"));
});

test("context builder selects goal-relevant source within token budget", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "context-test", scripts: { test: "node --test" } }), "utf8");
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "src", "authentication-handler.js"), "export function authenticate(user) { return Boolean(user); }\n", "utf8");
    await fs.writeFile(path.join(workspace, "src", "unrelated.js"), "export const value = 3;\n", "utf8");

    const context = await buildRepositoryContext(workspace, { goal: "fix authentication handler", maxContextTokens: 500 });
    assert.ok(context.selectedFiles.some((item) => item.path === "src/authentication-handler.js"));
    assert.ok(context.budget.approxTokensUsed <= context.budget.maxTokens);
    assert.ok(context.commandHints.some((hint) => hint.kind === "test"));
});

test("Git baseline reports expected and unexpected files separately", async () => {
    const workspace = await tempWorkspace();
    await initRepo(workspace);
    await fs.writeFile(path.join(workspace, "expected.js"), "export const x = 1;\n", "utf8");
    await git(workspace, ["add", "expected.js"]);
    await git(workspace, ["commit", "-m", "baseline"]);

    const baseline = await captureGitBaseline(workspace);
    await fs.writeFile(path.join(workspace, "expected.js"), "export const x = 2;\n", "utf8");
    await fs.writeFile(path.join(workspace, "rogue.txt"), "unexpected\n", "utf8");

    const diff = await summarizeGitDiff(workspace, baseline, ["expected.js"]);
    assert.equal(diff.available, true);
    assert.deepEqual(diff.changedFiles.map((item) => item.path), ["expected.js", "rogue.txt"]);
    assert.deepEqual(diff.unexpectedFiles.map((item) => item.path), ["rogue.txt"]);
    assert.equal(diff.summary.modified, 1);
    assert.equal(diff.summary.added, 1);
});

test("git_diff verifier fails closed on unrelated repository changes", async () => {
    const workspace = await tempWorkspace();
    await initRepo(workspace);
    await fs.writeFile(path.join(workspace, "app.js"), "console.log('one');\n", "utf8");
    await git(workspace, ["add", "app.js"]);
    await git(workspace, ["commit", "-m", "baseline"]);
    const baseline = await captureGitBaseline(workspace);

    await fs.writeFile(path.join(workspace, "app.js"), "console.log('two');\n", "utf8");
    let plan = { actions: [{ type: "replace_text", path: "app.js", find: "one", replace: "two" }], verify: [{ type: "git_diff", allowedPaths: ["app.js"] }] };
    let verification = await verifyPlan(plan, workspace, { apply: true, gitBaseline: baseline });
    assert.equal(verification.passed, true);

    await fs.writeFile(path.join(workspace, "surprise.txt"), "oops\n", "utf8");
    verification = await verifyPlan(plan, workspace, { apply: true, gitBaseline: baseline });
    assert.equal(verification.passed, false);
    assert.equal(verification.checks[0].type, "git_diff");
    assert.deepEqual(verification.checks[0].unexpectedFiles.map((item) => item.path), ["surprise.txt"]);
});
