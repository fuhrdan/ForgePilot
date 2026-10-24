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

function html({ workspace, machineConfig, runtimeHealth, controlToken } = {}) {
    const config = machineConfig ? JSON.stringify({
        tier: machineConfig.tier, profile: machineConfig.profile, model: machineConfig.model, visionModel: machineConfig.visionModel,
        memoryGiB: machineConfig.hardware?.memoryGiB, availableMemoryGiB: machineConfig.hardware?.availableMemoryGiB,
        logicalCpus: machineConfig.hardware?.logicalCpus, agentTeamEnabled: machineConfig.agentTeamEnabled,
        tools: machineConfig.hardware?.tools ?? {},
        healthStatus: runtimeHealth?.status ?? null,
        healthWarnings: runtimeHealth?.warnings ?? [],
        runtimeModel: runtimeHealth?.plan?.model ?? machineConfig.model,
        fallbackModels: runtimeHealth?.plan?.modelFallbacks ?? machineConfig.modelFallbacks ?? [],
        ollamaAvailable: runtimeHealth?.ollama?.available ?? false
    }).replace(/</g, "\\u003c") : "null";
    const workspaceJson = JSON.stringify(workspace ?? "").replace(/</g, "\\u003c");
    const tokenJson = JSON.stringify(controlToken).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgePilot</title><style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#172033;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1220px;margin:auto;padding:28px}.hero{background:#111827;color:#fff;border-radius:18px;padding:28px;box-shadow:0 12px 32px #0002}.hero h1{margin:0 0 8px;font-size:34px}.hero p{margin:4px 0;color:#cbd5e1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:18px 0}.card{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:18px;box-shadow:0 4px 18px #23304a0c}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#667085}.value{font-size:22px;font-weight:700;margin-top:5px}.ok{color:#18794e}.warn{color:#9a6700}.bad{color:#b42318}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.btn{display:inline-block;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;font-weight:700;border:0;cursor:pointer}.btn.secondary{background:#e9eef6;color:#172033}.btn.danger{background:#b42318}.btn.small{padding:6px 9px;font-size:12px}.btn:disabled{opacity:.5;cursor:not-allowed}.field{margin:12px 0}.field label{display:block;font-weight:700;margin-bottom:6px}.field input,.field textarea,.field select{width:100%;padding:10px 12px;border:1px solid #cfd7e5;border-radius:9px;font:inherit;background:#fff}.field textarea{min-height:110px;resize:vertical}.checks{display:flex;gap:12px;flex-wrap:wrap}.checks label{font-weight:500}.cmd,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#0b1020;color:#d5e2ff;padding:12px;border-radius:9px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}.PASS,.pass{font-weight:700;color:#18794e}.FAIL,.fail{font-weight:700;color:#b42318}.running{font-weight:700;color:#175cd3}.queued{font-weight:700;color:#9a6700}.paused,.interrupted{font-weight:700;color:#7a5af8}.muted{color:#667085;font-size:13px}.pill{display:inline-block;border-radius:999px;padding:4px 8px;background:#eef2f7;font-size:12px;margin:2px}.two{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.project-row{display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid #edf0f4;padding:8px 0}.project-row:last-child{border:0}@media(max-width:850px){.two,.three{grid-template-columns:1fr}}</style></head><body><div class="wrap">
<section class="hero"><h1>ForgePilot 0.14</h1><p>Adaptive runtime health, model fallback, low-resource throttling, and reversible verified engineering.</p><p id="workspace"></p><div class="actions"><button class="btn secondary" onclick="location.reload()">Refresh</button><button class="btn secondary" id="queueBtn" onclick="toggleQueue()">Pause queue</button></div></section>
<div class="grid"><div class="card"><div class="label">Machine tier</div><div class="value" id="tier">Not configured</div><div class="muted" id="hardware"></div></div><div class="card"><div class="label">Runtime health</div><div class="value" id="health">Checking…</div><div class="muted" id="healthDetail"></div></div><div class="card"><div class="label">Coding model</div><div class="value" id="model">—</div><div class="muted" id="vision"></div></div><div class="card"><div class="label">Task queue</div><div class="value" id="queueState">Loading…</div><div class="muted" id="queueCounts"></div></div></div>
<div class="two"><div class="card"><h2>Start engineering job</h2><div class="field"><label>Saved project</label><select id="project"><option value="">Manual path</option></select></div><div class="field"><label>Repository / workspace path</label><input id="repo" autocomplete="off"></div><div class="actions"><button class="btn secondary small" onclick="saveProject()">Save project</button><button class="btn secondary small" onclick="deleteProject()">Delete selected</button></div><div class="field"><label>Recipe</label><select id="recipe"><option value="">No recipe — use goal exactly</option></select></div><div class="field"><label>Goal</label><textarea id="goal" placeholder="Example: The retry counter becomes negative after the final authentication attempt."></textarea></div><div class="field"><label>Autonomy</label><select id="autonomy"><option value="safe">Safe — one repair, no multi-agent review</option><option value="standard" selected>Standard — machine-adaptive defaults</option><option value="thorough">Thorough — deeper review and up to three repairs</option></select></div><div class="field"><label>Approved capabilities</label><div class="checks"><label><input type="checkbox" class="perm" value="file_write" checked> File writes</label><label><input type="checkbox" class="perm" value="command_exec" checked> Local commands</label><label><input type="checkbox" class="perm" value="computer_control"> Computer control</label><label><input type="checkbox" class="perm" value="external_network"> External network</label><label><input type="checkbox" class="perm" value="secret_use"> Secrets</label><label><input type="checkbox" class="perm" value="sandbox_network"> Sandbox network</label></div></div><div class="field"><label><input type="checkbox" id="sandbox"> Run inside disposable sandbox (requires Docker/Podman)</label></div><div class="actions"><button class="btn secondary" id="analyzeBtn" onclick="analyzeRepo()">Analyze repository</button><button class="btn" id="runBtn" onclick="startJob()">Start verified job</button></div><p id="formMsg" class="muted"></p></div>
<div><div class="card"><h2>Repository analysis</h2><div id="analysis" class="muted">Choose a repository and click Analyze.</div></div><div class="card" style="margin-top:18px"><h2>Reusable recipes</h2><div id="recipeInfo" class="muted">Loading recipes…</div><div class="actions"><button class="btn secondary small" onclick="saveRecipe()">Save custom recipe</button><button class="btn secondary small" onclick="deleteRecipe()">Delete custom recipe</button></div></div></div></div>
<div class="card" style="margin-top:18px"><h2>Task queue</h2><div id="jobs" class="muted">No dashboard jobs yet.</div></div>
<div class="card" style="margin-top:18px"><h2>Recent verified runs</h2><table><thead><tr><th>Time</th><th>Status</th><th>Goal</th><th>Version</th><th>Signed</th></tr></thead><tbody id="runs"></tbody></table></div>
<script>
const cfg=${config};const workspace=${workspaceJson};const controlToken=${tokenJson};let projects=[];let recipes=[];let queuePaused=false;
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('#workspace').textContent='Launcher workspace: '+workspace;$('#repo').value=workspace;
if(cfg){$('#tier').textContent=cfg.tier||cfg.profile||'configured';$('#hardware').textContent=(cfg.memoryGiB??'?')+' GiB RAM / '+(cfg.availableMemoryGiB??'?')+' GiB available / '+(cfg.logicalCpus??'?')+' CPUs';$('#model').textContent=cfg.runtimeModel||cfg.model||'—';$('#vision').textContent='Vision: '+(cfg.visionModel||'disabled to save memory');$('#health').textContent=(cfg.healthStatus||'unknown').toUpperCase();$('#health').className='value '+(cfg.healthStatus==='ready'?'ok':cfg.healthStatus==='blocked'?'bad':'warn');$('#healthDetail').textContent=(cfg.ollamaAvailable?'Ollama ready':'Ollama unavailable')+(cfg.fallbackModels?.length?' · fallbacks: '+cfg.fallbackModels.join(' → '):'')+(cfg.healthWarnings?.length?' · '+cfg.healthWarnings[0]:'')}
async function api(url,options={}){const headers={'content-type':'application/json','x-forgepilot-token':controlToken,...(options.headers||{})};const r=await fetch(url,{...options,headers});const body=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));return body}
function permissions(){return [...document.querySelectorAll('.perm:checked')].map(x=>x.value)}
function setPermissions(items){document.querySelectorAll('.perm').forEach(x=>x.checked=(items||[]).includes(x.value))}
async function refreshProjects(){projects=await api('/api/projects');const select=$('#project');select.innerHTML='<option value="">Manual path</option>'+projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')}
async function refreshRecipes(){recipes=await api('/api/recipes');const select=$('#recipe');select.innerHTML='<option value="">No recipe — use goal exactly</option>'+recipes.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+(r.builtin?'':' (custom)')+'</option>').join('');renderRecipeInfo()}
function renderRecipeInfo(){const r=recipes.find(x=>x.id===$('#recipe').value);$('#recipeInfo').innerHTML=r?'<b>'+esc(r.name)+'</b><p>'+esc(r.description||'Custom workflow')+'</p><p class="muted">Defaults: '+esc(r.autonomy)+' / '+esc((r.approvals||[]).join(', ')||'no grants')+(r.sandbox?' / sandbox':'')+'</p>':'Choose a recipe to apply a reusable engineering workflow.'}
$('#recipe').addEventListener('change',()=>{const r=recipes.find(x=>x.id===$('#recipe').value);renderRecipeInfo();if(r){$('#autonomy').value=r.autonomy||'standard';setPermissions(r.approvals||[]);$('#sandbox').checked=!!r.sandbox}});
$('#project').addEventListener('change',()=>{const p=projects.find(x=>x.id===$('#project').value);if(!p)return;$('#repo').value=p.path;$('#autonomy').value=p.autonomy||'standard';$('#recipe').value=p.recipeId||'';setPermissions(p.approvals||[]);$('#sandbox').checked=!!p.sandbox;renderRecipeInfo()});
async function saveProject(){try{const current=projects.find(x=>x.id===$('#project').value);const name=prompt('Project name',current?.name||($('#repo').value.split(/[\\/]/).filter(Boolean).pop()||'Project'));if(!name)return;const saved=await api('/api/projects',{method:'POST',body:JSON.stringify({id:current?.id,name,path:$('#repo').value,recipeId:$('#recipe').value||null,autonomy:$('#autonomy').value,approvals:permissions(),sandbox:$('#sandbox').checked})});await refreshProjects();$('#project').value=saved.id;$('#formMsg').textContent='Project saved.'}catch(e){$('#formMsg').textContent=e.message}}
async function deleteProject(){const id=$('#project').value;if(!id)return;if(!confirm('Remove this saved project from ForgePilot? The repository itself will not be deleted.'))return;await api('/api/projects/'+encodeURIComponent(id),{method:'DELETE'});await refreshProjects();$('#project').value=''}
async function saveRecipe(){try{const name=prompt('Custom recipe name','My workflow');if(!name)return;const prefix=prompt('Instructions to place before the goal','Inspect the repository and follow existing conventions.');if(prefix===null)return;const suffix=prompt('Instructions to place after the goal','Run relevant tests/build and verify unrelated files were not changed.');if(suffix===null)return;const saved=await api('/api/recipes',{method:'POST',body:JSON.stringify({name,prefix,suffix,autonomy:$('#autonomy').value,approvals:permissions(),sandbox:$('#sandbox').checked})});await refreshRecipes();$('#recipe').value=saved.id;renderRecipeInfo()}catch(e){alert(e.message)}}
async function deleteRecipe(){const id=$('#recipe').value;const r=recipes.find(x=>x.id===id);if(!r||r.builtin)return alert('Choose a custom recipe to delete.');if(!confirm('Delete custom recipe '+r.name+'?'))return;await api('/api/recipes/'+encodeURIComponent(id),{method:'DELETE'});await refreshRecipes()}
async function analyzeRepo(){try{$('#formMsg').textContent='Analyzing…';const body={workspace:$('#repo').value,goal:$('#goal').value};const [a,p]=await Promise.all([api('/api/analyze',{method:'POST',body:JSON.stringify(body)}),api('/api/preflight',{method:'POST',body:JSON.stringify(body)})]);const ps=(a.projects||[]).map(x=>'<span class="pill">'+esc(x.language)+(x.frameworks?.length?' / '+esc(x.frameworks.join(', ')):'')+'</span>').join(' ');const cmds=(a.commandHints||[]).map(c=>'<li>'+esc(c.kind)+': <code>'+esc(c.command+' '+(c.args||[]).join(' '))+'</code></li>').join('');const risk='<p><b>Risk: <span class="'+(p.risk.level==='high'?'bad':p.risk.level==='medium'?'warn':'ok')+'">'+esc(p.risk.level.toUpperCase())+'</span></b> ('+esc(p.risk.points)+')</p><ul>'+(p.risk.reasons||[]).map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul><p class="muted">Likely touch points: '+esc((p.likelyTouched||[]).slice(0,10).join(', ')||'none')+' · existing dirty paths: '+esc(p.dirty?.entries?.length||0)+'</p>';$('#analysis').innerHTML=risk+'<p><b>'+esc(a.scan.fileCount)+' files</b> '+esc(a.scan.source)+'</p><p>'+ps+'</p><ul>'+cmds+'</ul><p class="muted">Relevant context: '+esc((a.selectedFiles||[]).map(x=>x.path).slice(0,8).join(', ')||'none')+'</p>';$('#formMsg').textContent='Repository analysis and risk preflight complete.'}catch(e){$('#formMsg').textContent=e.message}}
async function startJob(){try{const perms=permissions();$('#runBtn').disabled=true;$('#formMsg').textContent='Queueing…';const job=await api('/api/jobs',{method:'POST',body:JSON.stringify({workspace:$('#repo').value,goal:$('#goal').value,recipeId:$('#recipe').value||null,autonomy:$('#autonomy').value,approvals:perms,sandbox:$('#sandbox').checked})});$('#formMsg').textContent='Job '+job.id+' queued.';await refreshJobs()}catch(e){$('#formMsg').textContent=e.message}finally{$('#runBtn').disabled=false}}
async function jobAction(id,action){try{await api('/api/jobs/'+encodeURIComponent(id)+'/'+action,{method:'POST',body:'{}'});await refreshJobs()}catch(e){alert(e.message)}}
async function retryJob(id){try{await api('/api/jobs/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'});await refreshJobs()}catch(e){alert(e.message)}}
async function rollbackJob(id){try{const dry=await api('/api/jobs/'+encodeURIComponent(id)+'/rollback',{method:'POST',body:JSON.stringify({dryRun:true})});if(!dry.passed){alert('Rollback blocked because one or more files changed after ForgePilot finished: '+dry.conflicts.map(x=>x.path).join(', '));return}if(!confirm('Rollback '+dry.restored.length+' ForgePilot change(s)? Newer edits are protected by hash checks.'))return;const result=await api('/api/jobs/'+encodeURIComponent(id)+'/rollback',{method:'POST',body:JSON.stringify({dryRun:false})});alert(result.message);await refreshJobs()}catch(e){alert(e.message)}}
async function toggleQueue(){try{const q=await api('/api/queue/'+(queuePaused?'resume':'pause'),{method:'POST',body:'{}'});renderQueue(q);await refreshJobs()}catch(e){alert(e.message)}}
function renderQueue(q){queuePaused=!!q.paused;$('#queueState').textContent=queuePaused?'PAUSED':'RUNNING';$('#queueState').className='value '+(queuePaused?'warn':'ok');$('#queueCounts').textContent=q.running+' running / '+q.queued+' queued / '+q.pausedJobs+' paused';$('#queueBtn').textContent=queuePaused?'Resume queue':'Pause queue'}
async function refreshQueue(){renderQueue(await api('/api/queue'))}
async function refreshJobs(){try{const rows=await api('/api/jobs');if(!rows.length){$('#jobs').innerHTML='<span class="muted">No dashboard jobs yet.</span>';return}$('#jobs').innerHTML=rows.map(j=>{let buttons='';if(j.status==='running')buttons='<button class="btn danger small" onclick="jobAction(\''+esc(j.id)+'\',\'cancel\')">Cancel</button>';else if(j.status==='queued')buttons='<button class="btn secondary small" onclick="jobAction(\''+esc(j.id)+'\',\'pause\')">Pause</button> <button class="btn danger small" onclick="jobAction(\''+esc(j.id)+'\',\'cancel\')">Cancel</button>';else if(j.status==='paused')buttons='<button class="btn small" onclick="jobAction(\''+esc(j.id)+'\',\'resume\')">Resume</button> <button class="btn danger small" onclick="jobAction(\''+esc(j.id)+'\',\'cancel\')">Cancel</button>';else {buttons='<button class="btn secondary small" onclick="retryJob(\''+esc(j.id)+'\')">Retry</button>';if(j.checkpoint?.rollbackAvailable)buttons+=' <button class="btn danger small" onclick="rollbackJob(\''+esc(j.id)+'\')">Rollback changes</button>';}const risk=j.preflight?.risk?.level?'<span class="pill '+(j.preflight.risk.level==='high'?'bad':j.preflight.risk.level==='medium'?'warn':'ok')+'">risk '+esc(j.preflight.risk.level)+'</span>':'';const changes=j.changeSet?'<div class="muted">Changes: +'+esc(j.changeSet.summary.added)+' / ~'+esc(j.changeSet.summary.modified)+' / -'+esc(j.changeSet.summary.deleted)+' · '+esc((j.changeSet.changedFiles||[]).map(x=>x.path).slice(0,8).join(', ')||'none')+'</div>':'';return '<div class="card" style="margin:10px 0"><div><b>'+esc(j.goal)+'</b></div><div><span class="pill '+esc(j.status)+'">'+esc(j.status)+'</span><span class="pill">phase: '+esc(j.phase)+'</span><span class="pill">'+esc(j.autonomy)+'</span>'+risk+(j.recipeName?'<span class="pill">'+esc(j.recipeName)+'</span>':'')+(j.retryOf?'<span class="pill">retry</span>':'')+(j.signed?'<span class="pill ok">signed ✓</span>':'')+(j.rollback?.passed?'<span class="pill warn">rolled back</span>':'')+'</div><div class="muted">'+esc(j.workspace)+'</div>'+changes+'<pre>'+esc((j.log||'').slice(-5000))+'</pre><div class="actions">'+buttons+'</div></div>'}).join('')}catch(e){$('#jobs').textContent=e.message}}
async function refreshRuns(){const rows=await api('/api/runs');$('#runs').innerHTML=rows.length?rows.map(x=>'<tr><td>'+esc(x.createdAt||'')+'</td><td class="'+esc(x.status||'')+'">'+esc(x.status||'')+'</td><td>'+esc(x.goal||'')+'</td><td>'+esc(x.version||'')+'</td><td>'+(x.signed?'✓':'—')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}
Promise.all([refreshProjects(),refreshRecipes(),refreshJobs(),refreshRuns(),refreshQueue()]);setInterval(()=>{refreshJobs();refreshRuns();refreshQueue()},2000);
</script></div></body></html>`;
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
