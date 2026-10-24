import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyReportProvenance } from "../security/provenance.js";
import { DashboardJobManager } from "./jobs.js";

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
            runs.push({ runId: name, createdAt: report.createdAt, taskId: report.taskId, goal: report.goal, status: report.status, version: report.version, signed: Boolean(provenance?.passed), keyId: provenance?.keyId ?? null });
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

function html({ workspace, machineConfig, controlToken } = {}) {
    const config = machineConfig ? JSON.stringify({
        tier: machineConfig.tier, profile: machineConfig.profile, model: machineConfig.model, visionModel: machineConfig.visionModel,
        memoryGiB: machineConfig.hardware?.memoryGiB, availableMemoryGiB: machineConfig.hardware?.availableMemoryGiB,
        logicalCpus: machineConfig.hardware?.logicalCpus, agentTeamEnabled: machineConfig.agentTeamEnabled,
        tools: machineConfig.hardware?.tools ?? {}
    }).replace(/</g, "\\u003c") : "null";
    const workspaceJson = JSON.stringify(workspace ?? "").replace(/</g, "\\u003c");
    const tokenJson = JSON.stringify(controlToken).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgePilot</title><style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#172033;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:28px}.hero{background:#111827;color:#fff;border-radius:18px;padding:28px;box-shadow:0 12px 32px #0002}.hero h1{margin:0 0 8px;font-size:34px}.hero p{margin:4px 0;color:#cbd5e1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:18px 0}.card{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:18px;box-shadow:0 4px 18px #23304a0c}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#667085}.value{font-size:22px;font-weight:700;margin-top:5px}.ok{color:#18794e}.warn{color:#9a6700}.bad{color:#b42318}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.btn{display:inline-block;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;font-weight:700;border:0;cursor:pointer}.btn.secondary{background:#e9eef6;color:#172033}.btn.danger{background:#b42318}.btn:disabled{opacity:.5;cursor:not-allowed}.field{margin:12px 0}.field label{display:block;font-weight:700;margin-bottom:6px}.field input,.field textarea,.field select{width:100%;padding:10px 12px;border:1px solid #cfd7e5;border-radius:9px;font:inherit;background:#fff}.field textarea{min-height:110px;resize:vertical}.checks{display:flex;gap:12px;flex-wrap:wrap}.checks label{font-weight:500}.cmd,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#0b1020;color:#d5e2ff;padding:12px;border-radius:9px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}.PASS,.pass{font-weight:700;color:#18794e}.FAIL,.fail{font-weight:700;color:#b42318}.running{font-weight:700;color:#175cd3}.muted{color:#667085;font-size:13px}.pill{display:inline-block;border-radius:999px;padding:4px 8px;background:#eef2f7;font-size:12px;margin:2px}.hidden{display:none}.two{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}@media(max-width:850px){.two{grid-template-columns:1fr}}</style></head><body><div class="wrap">
<section class="hero"><h1>ForgePilot 0.11</h1><p>Local verified software-engineering control center.</p><p id="workspace"></p><div class="actions"><button class="btn secondary" onclick="location.reload()">Refresh</button></div></section>
<div class="grid"><div class="card"><div class="label">Machine tier</div><div class="value" id="tier">Not configured</div><div class="muted" id="hardware"></div></div><div class="card"><div class="label">Coding model</div><div class="value" id="model">—</div><div class="muted" id="vision"></div></div><div class="card"><div class="label">Agent team</div><div class="value" id="agents">—</div><div class="muted" id="ollama"></div></div></div>
<div class="two"><div class="card"><h2>Start engineering job</h2><div class="field"><label>Repository / workspace path</label><input id="repo" autocomplete="off"></div><div class="field"><label>Goal</label><textarea id="goal" placeholder="Example: Fix the retry bug in authentication. Add a regression test first, make the smallest safe change, run tests/build, and verify unrelated files were not changed."></textarea></div><div class="field"><label>Autonomy</label><select id="autonomy"><option value="safe">Safe — one repair, no multi-agent review</option><option value="standard" selected>Standard — machine-adaptive defaults</option><option value="thorough">Thorough — deeper review and up to three repairs</option></select></div><div class="field"><label>Approved capabilities</label><div class="checks"><label><input type="checkbox" class="perm" value="file_write" checked> File writes</label><label><input type="checkbox" class="perm" value="command_exec" checked> Local commands</label><label><input type="checkbox" class="perm" value="computer_control"> Computer control</label><label><input type="checkbox" class="perm" value="external_network"> External network</label><label><input type="checkbox" class="perm" value="secret_use"> Secrets</label><label><input type="checkbox" class="perm" value="sandbox_network"> Sandbox network</label></div></div><div class="field"><label><input type="checkbox" id="sandbox"> Run inside disposable sandbox (requires Docker/Podman)</label></div><div class="actions"><button class="btn secondary" id="analyzeBtn" onclick="analyzeRepo()">Analyze repository</button><button class="btn" id="runBtn" onclick="startJob()">Start verified job</button></div><p id="formMsg" class="muted"></p></div>
<div class="card"><h2>Repository analysis</h2><div id="analysis" class="muted">Choose a repository and click Analyze.</div></div></div>
<div class="card" style="margin-top:18px"><h2>Active jobs</h2><div id="jobs" class="muted">No dashboard jobs yet.</div></div>
<div class="card" style="margin-top:18px"><h2>Recent verified runs</h2><table><thead><tr><th>Time</th><th>Status</th><th>Goal</th><th>Version</th><th>Signed</th></tr></thead><tbody id="runs"></tbody></table></div>
<script>
const cfg=${config};const workspace=${workspaceJson};const controlToken=${tokenJson};
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('#workspace').textContent='Launcher workspace: '+workspace;$('#repo').value=workspace;
if(cfg){$('#tier').textContent=cfg.tier||cfg.profile||'configured';$('#hardware').textContent=(cfg.memoryGiB??'?')+' GiB RAM / '+(cfg.availableMemoryGiB??'?')+' GiB available / '+(cfg.logicalCpus??'?')+' CPUs';$('#model').textContent=cfg.model||'—';$('#vision').textContent='Vision: '+(cfg.visionModel||'disabled to save memory');$('#agents').textContent=cfg.agentTeamEnabled?'ON':'OFF / low-resource mode';$('#ollama').textContent=cfg.tools?.ollama?'Ollama detected':'Ollama not detected — AI jobs will fail until installed'}
async function api(url,options={}){const headers={'content-type':'application/json','x-forgepilot-token':controlToken,...(options.headers||{})};const r=await fetch(url,{...options,headers});const body=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));return body}
function permissions(){return [...document.querySelectorAll('.perm:checked')].map(x=>x.value)}
async function analyzeRepo(){try{$('#formMsg').textContent='Analyzing…';const a=await api('/api/analyze',{method:'POST',body:JSON.stringify({workspace:$('#repo').value,goal:$('#goal').value})});const projects=(a.projects||[]).map(p=>'<span class="pill">'+esc(p.language)+(p.frameworks?.length?' / '+esc(p.frameworks.join(', ')):'')+'</span>').join(' ');const cmds=(a.commandHints||[]).map(c=>'<li>'+esc(c.kind)+': <code>'+esc(c.command+' '+(c.args||[]).join(' '))+'</code></li>').join('');$('#analysis').innerHTML='<p><b>'+esc(a.scan.fileCount)+' files</b> '+esc(a.scan.source)+'</p><p>'+projects+'</p><ul>'+cmds+'</ul><p class="muted">Relevant context: '+esc((a.selectedFiles||[]).map(x=>x.path).slice(0,8).join(', ')||'none')+'</p>';$('#formMsg').textContent='Repository analysis complete.'}catch(e){$('#formMsg').textContent=e.message}}
async function startJob(){try{const perms=permissions();if(!perms.includes('file_write')||!perms.includes('command_exec')){if(!confirm('File writes or local commands are not approved. The job is likely to stop at the first denied action. Continue?'))return}$('#runBtn').disabled=true;$('#formMsg').textContent='Starting…';const job=await api('/api/jobs',{method:'POST',body:JSON.stringify({workspace:$('#repo').value,goal:$('#goal').value,autonomy:$('#autonomy').value,approvals:perms,sandbox:$('#sandbox').checked})});$('#formMsg').textContent='Job '+job.id+' started.';await refreshJobs()}catch(e){$('#formMsg').textContent=e.message}finally{$('#runBtn').disabled=false}}
async function cancelJob(id){try{await api('/api/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:'{}'});await refreshJobs()}catch(e){alert(e.message)}}
async function refreshJobs(){try{const rows=await api('/api/jobs');if(!rows.length){$('#jobs').innerHTML='<span class="muted">No dashboard jobs yet.</span>';return}$('#jobs').innerHTML=rows.map(j=>'<div class="card" style="margin:10px 0"><div><b>'+esc(j.goal)+'</b></div><div><span class="pill '+esc(j.status)+'">'+esc(j.status)+'</span><span class="pill">phase: '+esc(j.phase)+'</span><span class="pill">'+esc(j.autonomy)+'</span>'+(j.signed?'<span class="pill ok">signed ✓</span>':'')+'</div><div class="muted">'+esc(j.workspace)+'</div><pre>'+esc((j.log||'').slice(-6000))+'</pre>'+(j.status==='running'?'<button class="btn danger" onclick="cancelJob(\''+esc(j.id)+'\')">Cancel</button>':'')+'</div>').join('')}catch(e){$('#jobs').textContent=e.message}}
async function refreshRuns(){const rows=await api('/api/runs');$('#runs').innerHTML=rows.length?rows.map(x=>'<tr><td>'+esc(x.createdAt||'')+'</td><td class="'+esc(x.status||'')+'">'+esc(x.status||'')+'</td><td>'+esc(x.goal||'')+'</td><td>'+esc(x.version||'')+'</td><td>'+(x.signed?'✓':'—')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}
refreshJobs();refreshRuns();setInterval(()=>{refreshJobs();refreshRuns()},2000);
</script></div></body></html>`;
}

export async function createDashboardServer({ workspace, host = "127.0.0.1", port = 3210, launcher = null, jobManager = null } = {}) {
    if (!["127.0.0.1","localhost","::1"].includes(host)) throw new Error("ForgePilot dashboard is loopback-only.");
    const resolvedWorkspace = path.resolve(workspace ?? ".");
    const controlToken = crypto.randomBytes(24).toString("hex");
    const manager = jobManager ?? new DashboardJobManager({ machineConfig: launcher?.machineConfig ?? null });
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            const isMutation = req.method !== "GET" && req.method !== "HEAD";
            if (isMutation && req.headers["x-forgepilot-token"] !== controlToken) return json(res, 403, { error: "Invalid ForgePilot control token." });
            if (url.pathname === "/api/runs" && req.method === "GET") return json(res, 200, await listRuns(resolvedWorkspace));
            if (url.pathname === "/api/system" && req.method === "GET") return json(res, 200, launcher?.machineConfig ?? null);
            if (url.pathname === "/api/jobs" && req.method === "GET") return json(res, 200, manager.list());
            if (url.pathname === "/api/jobs" && req.method === "POST") return json(res, 202, await manager.create(await readJsonBody(req)));
            if (url.pathname === "/api/analyze" && req.method === "POST") return json(res, 200, await manager.analyze(await readJsonBody(req)));
            const cancel = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/cancel$/);
            if (cancel && req.method === "POST") return json(res, manager.cancel(cancel[1]) ? 200 : 409, { cancelled: manager.get(cancel[1])?.phase === "cancelling" });
            const detail = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
            if (detail && req.method === "GET") { const job = manager.get(detail[1]); return job ? json(res, 200, job) : json(res, 404, { error: "Job not found." }); }
            const report = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/report$/);
            if (report && req.method === "GET") { const value = await manager.report(report[1]); return value ? json(res, 200, value) : json(res, 404, { error: "Report not available." }); }
            if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", "x-frame-options": "DENY", "x-content-type-options": "nosniff" });
                res.end(html({ workspace: resolvedWorkspace, machineConfig: launcher?.machineConfig ?? null, controlToken }));
                return;
            }
            res.writeHead(404); res.end("Not found");
        } catch (error) {
            json(res, 500, { error: error.message });
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
    const address = server.address();
    return { server, host, port: typeof address === "object" && address ? address.port : port, workspace: resolvedWorkspace, jobManager: manager, controlToken };
}
