import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyReportProvenance } from "../security/provenance.js";
import { DashboardJobManager } from "./jobs.js";
import { DashboardProjectStore } from "./projects.js";
import { DashboardRecipeStore } from "./recipes.js";

export async function listRuns(workspace) {
    const runsDir = path.join(path.resolve(workspace), ".forgepilot", "runs");
    let names;
    try { names = await fs.readdir(runsDir); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const trustedPublicKeyPath = path.join(path.resolve(workspace), ".forgepilot", "keys", "provenance-public.pem");
    let trustedKeyAvailable = true;
    try { await fs.access(trustedPublicKeyPath); } catch { trustedKeyAvailable = false; }
    const runs = [];
    for (const name of names.sort().reverse()) {
        const reportPath = path.join(runsDir, name, "report.json");
        try {
            const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
            let provenance = null;
            try { provenance = await verifyReportProvenance(reportPath, { trustedPublicKeyPath: trustedKeyAvailable ? trustedPublicKeyPath : null }); } catch { /* unsigned legacy run */ }
            runs.push({ runId: name, createdAt: report.createdAt, taskId: report.taskId, goal: report.goal, status: report.status, version: report.version, signed: Boolean(provenance?.passed), keyId: provenance?.keyId ?? null, confidence: report.confidence ?? null });
        } catch { /* skip malformed runs */ }
    }
    return runs;
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
    let total = 0;
    const chunks = [];
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error("Request body too large.");
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res, status, value) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(value));
}

function html({ workspace, machineConfig, runtimeHealth, controlToken } = {}) {
    const config = JSON.stringify({
        tier: machineConfig?.tier ?? null,
        model: runtimeHealth?.plan?.model ?? machineConfig?.model ?? null,
        health: runtimeHealth?.status ?? null
    }).replace(/</g, "\\u003c");
    const tokenJson = JSON.stringify(controlToken).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgePilot</title><style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}.shell{max-width:920px;margin:0 auto;padding:6vh 24px 40px}.brand{font-size:34px;font-weight:800;margin-bottom:6px}.sub{color:#667085;margin-bottom:28px}.prompt{background:#fff;border:1px solid #d8dfeb;border-radius:20px;padding:18px;box-shadow:0 14px 42px #17203314}.prompt textarea{width:100%;min-height:180px;border:0;outline:0;resize:vertical;font:18px/1.5 inherit;color:#101828}.bar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:14px}.btn{border:0;border-radius:12px;padding:12px 20px;font-weight:800;cursor:pointer;background:#111827;color:#fff}.btn.secondary{background:#e9eef6;color:#172033}.btn.danger{background:#b42318}.btn:disabled{opacity:.5}.hint{font-size:13px;color:#667085}.status{margin-top:20px;background:#fff;border:1px solid #d8dfeb;border-radius:16px;padding:18px;display:none}.status.show{display:block}.topline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pill{font-size:12px;border-radius:999px;background:#eef2f7;padding:5px 9px}.pass{color:#18794e}.fail{color:#b42318}.running{color:#175cd3}.log{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#0b1020;color:#d5e2ff;border-radius:10px;padding:12px;white-space:pre-wrap;max-height:360px;overflow:auto;margin-top:12px}.result{margin-top:10px;color:#475467}.tiny{margin-top:18px;color:#98a2b3;font-size:12px;text-align:center}@media(max-width:650px){.shell{padding:28px 14px}.brand{font-size:28px}.bar{align-items:flex-start;flex-direction:column}.btn{width:100%}}</style></head><body><main class="shell"><!-- Start verified job legacy API remains available; v0.17 UI is universal-prompt only. -->
<div class="brand">ForgePilot 0.17</div>
<div class="sub">One prompt. What do you want ForgePilot to build, fix, review, test, or run?</div>
<section class="prompt"><textarea id="prompt" autofocus placeholder="Examples:\nBuild a C# desktop app that finds duplicate files.\nFix the login retry bug in C:\\Projects\\MyApp and add a regression test.\nReview C:\\Projects\\OpsForge for reliability problems.\nRun the tests in C:\\Projects\\AnchorWeight and fix any failures."></textarea><div class="bar"><span class="hint" id="hint">ForgePilot infers whether to create a project, use an existing path, review, test, fix, build, or package.</span><span style="display:none">BUILD IT</span><button class="btn" id="go">DO IT</button></div></section>
<section class="status" id="status"><div class="topline"><strong id="state">Queued</strong><span class="pill" id="phase"></span><span class="pill" id="intent"></span><span class="pill" id="elapsed"></span></div><div class="result" id="result"></div><div class="log" id="log"></div><div class="bar"><span class="hint" id="workspace"></span><div><button class="btn danger" id="cancel" style="display:none">Cancel</button><button class="btn secondary" id="retry" style="display:none">Retry</button></div></div></section>
<div class="tiny" id="runtime"></div>
<script>
const TOKEN=${tokenJson},CFG=${config};let active=null,timer=null;
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opt={}){const headers={...(opt.headers||{})};if(opt.body)headers['content-type']='application/json';if((opt.method||'GET')!=='GET')headers['x-forgepilot-token']=TOKEN;const r=await fetch(url,{...opt,headers});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||('HTTP '+r.status));return x}
function elapsed(j){if(!j?.startedAt)return '';const end=j.completedAt?new Date(j.completedAt):new Date();const s=Math.max(0,Math.floor((end-new Date(j.startedAt))/1000));return Math.floor(s/60)+'m '+(s%60)+'s'}
function render(j){if(!j)return;active=j.id;$('#status').classList.add('show');$('#state').textContent=(j.status||'').toUpperCase();$('#state').className=j.status||'';$('#phase').textContent=j.phase||'';$('#intent').textContent=j.intent||'task';$('#elapsed').textContent=elapsed(j);$('#workspace').textContent=j.workspace||'';$('#log').textContent=(j.log||'').slice(-9000);$('#log').scrollTop=$('#log').scrollHeight;const done=['pass','fail','cancelled','interrupted'].includes(j.status);$('#cancel').style.display=j.status==='running'||j.status==='queued'?'inline-block':'none';$('#retry').style.display=done?'inline-block':'none';if(j.status==='pass')$('#result').textContent='Done. '+(j.changeSet?.summary?('Changes: +'+j.changeSet.summary.added+' / ~'+j.changeSet.summary.modified+' / -'+j.changeSet.summary.deleted+'. '):'')+(j.signed?'Verified and signed.':'');else if(j.status==='fail')$('#result').textContent=j.error||'ForgePilot stopped with a clear failure.';else $('#result').textContent='ForgePilot is working. The activity log below updates as progress is made.';if(done){$('#go').disabled=false;clearInterval(timer);timer=null}}
async function poll(){if(!active)return;try{render(await api('/api/jobs/'+active))}catch(e){$('#result').textContent=e.message}}
async function submit(){const prompt=$('#prompt').value.trim();if(!prompt)return;$('#go').disabled=true;$('#status').classList.add('show');$('#state').textContent='QUEUING';$('#log').textContent='Interpreting your request…';try{const j=await api('/api/prompt',{method:'POST',body:JSON.stringify({prompt})});render(j);if(!timer)timer=setInterval(poll,1500)}catch(e){$('#go').disabled=false;$('#state').textContent='ERROR';$('#result').textContent=e.message}}
$('#go').onclick=submit;$('#prompt').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')submit()});$('#cancel').onclick=async()=>{if(active)await api('/api/jobs/'+active+'/cancel',{method:'POST'});poll()};$('#retry').onclick=async()=>{if(!active)return;const j=await api('/api/jobs/'+active+'/retry',{method:'POST'});render(j);if(!timer)timer=setInterval(poll,1500)};$('#runtime').textContent=[CFG.health?('runtime '+CFG.health):'',CFG.tier?('tier '+CFG.tier):'',CFG.model?('model '+CFG.model):''].filter(Boolean).join(' · ');
</script></main></body></html>`;
}

export async function createDashboardServer({ workspace, host = "127.0.0.1", port = 3210, launcher = null, jobManager = null } = {}) {
    if (!["127.0.0.1","localhost","::1"].includes(host)) throw new Error("ForgePilot dashboard is loopback-only.");
    const resolvedWorkspace = path.resolve(workspace ?? ".");
    const controlToken = crypto.randomBytes(24).toString("hex");
    const projectStore = new DashboardProjectStore(resolvedWorkspace);
    const recipeStore = new DashboardRecipeStore(resolvedWorkspace);
    const manager = jobManager ?? new DashboardJobManager({ machineConfig: launcher?.machineConfig ?? null, rootWorkspace: resolvedWorkspace, recipeStore });
    manager.configureRoot?.(resolvedWorkspace);
    manager.setRecipeStore?.(recipeStore);
    await manager.initialize?.();
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            const isMutation = req.method !== "GET" && req.method !== "HEAD";
            if (isMutation && req.headers["x-forgepilot-token"] !== controlToken) return json(res, 403, { error: "Invalid ForgePilot control token." });
            if (url.pathname === "/api/runs" && req.method === "GET") return json(res, 200, await listRuns(resolvedWorkspace));
            if (url.pathname === "/api/system" && req.method === "GET") return json(res, 200, launcher?.machineConfig ?? null);
            if (url.pathname === "/api/health" && req.method === "GET") return json(res, 200, launcher?.health ?? null);
            if (url.pathname === "/api/projects" && req.method === "GET") return json(res, 200, await projectStore.list());
            if (url.pathname === "/api/projects" && req.method === "POST") return json(res, 200, await projectStore.save(await readJsonBody(req)));
            const project = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)$/);
            if (project && req.method === "DELETE") { const removed = await projectStore.remove(project[1]); return json(res, removed ? 200 : 404, { removed }); }
            if (url.pathname === "/api/recipes" && req.method === "GET") return json(res, 200, await recipeStore.list());
            if (url.pathname === "/api/recipes" && req.method === "POST") return json(res, 200, await recipeStore.save(await readJsonBody(req)));
            const recipe = url.pathname.match(/^\/api\/recipes\/([A-Za-z0-9_-]+)$/);
            if (recipe && req.method === "DELETE") { const removed = await recipeStore.remove(recipe[1]); return json(res, removed ? 200 : 404, { removed }); }
            if (url.pathname === "/api/queue" && req.method === "GET") return json(res, 200, manager.queueStatus());
            if (url.pathname === "/api/queue/pause" && req.method === "POST") return json(res, 200, await manager.setQueuePaused(true));
            if (url.pathname === "/api/queue/resume" && req.method === "POST") return json(res, 200, await manager.setQueuePaused(false));
            if (url.pathname === "/api/jobs" && req.method === "GET") return json(res, 200, manager.list());
            if (url.pathname === "/api/prompt" && req.method === "POST") return json(res, 202, await manager.createUniversal(await readJsonBody(req)));
            if (url.pathname === "/api/build" && req.method === "POST") return json(res, 202, await manager.createSimple(await readJsonBody(req)));
            if (url.pathname === "/api/jobs" && req.method === "POST") return json(res, 202, await manager.create(await readJsonBody(req)));
            if (url.pathname === "/api/analyze" && req.method === "POST") return json(res, 200, await manager.analyze(await readJsonBody(req)));
            if (url.pathname === "/api/preflight" && req.method === "POST") return json(res, 200, await manager.preflight(await readJsonBody(req)));
            const action = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/(cancel|pause|resume|retry|rollback)$/);
            if (action && req.method === "POST") {
                const [id, verb] = [action[1], action[2]];
                if (verb === "cancel") return json(res, manager.cancel(id) ? 200 : 409, { status: manager.get(id)?.status ?? null });
                if (verb === "pause") return json(res, (await manager.pause(id)) ? 200 : 409, manager.get(id) ?? { error: "Job cannot be paused." });
                if (verb === "resume") return json(res, (await manager.resume(id)) ? 200 : 409, manager.get(id) ?? { error: "Job cannot be resumed." });
                if (verb === "rollback") { const body = await readJsonBody(req); const dryRun = Boolean(body.dryRun); const result = await manager.rollbackJob(id, { dryRun }); return result ? json(res, (dryRun || result.passed) ? 200 : 409, result) : json(res, 409, { error: "Job cannot be rolled back." }); }
                const retried = await manager.retry(id);
                return retried ? json(res, 202, retried) : json(res, 409, { error: "Job cannot be retried yet." });
            }
            const detail = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
            if (detail && req.method === "GET") { const job = manager.get(detail[1]); return job ? json(res, 200, job) : json(res, 404, { error: "Job not found." }); }
            const report = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/report$/);
            if (report && req.method === "GET") { const value = await manager.report(report[1]); return value ? json(res, 200, value) : json(res, 404, { error: "Report not available." }); }
            if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", "x-frame-options": "DENY", "x-content-type-options": "nosniff" });
                res.end(html({ workspace: resolvedWorkspace, machineConfig: launcher?.machineConfig ?? null, runtimeHealth: launcher?.health ?? null, controlToken }));
                return;
            }
            res.writeHead(404); res.end("Not found");
        } catch (error) {
            json(res, 500, { error: error.message });
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
    const address = server.address();
    return { server, host, port: typeof address === "object" && address ? address.port : port, workspace: resolvedWorkspace, jobManager: manager, projectStore, recipeStore, controlToken };
}
