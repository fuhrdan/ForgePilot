import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyReportProvenance } from "../security/provenance.js";

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
            runs.push({
                runId: name,
                createdAt: report.createdAt,
                taskId: report.taskId,
                goal: report.goal,
                status: report.status,
                version: report.version,
                signed: Boolean(provenance?.passed),
                keyId: provenance?.keyId ?? null
            });
        } catch { /* skip malformed runs */ }
    }
    return runs;
}

function html({ workspace, machineConfig } = {}) {
    const config = machineConfig ? JSON.stringify({
        tier: machineConfig.tier,
        profile: machineConfig.profile,
        model: machineConfig.model,
        visionModel: machineConfig.visionModel,
        memoryGiB: machineConfig.hardware?.memoryGiB,
        availableMemoryGiB: machineConfig.hardware?.availableMemoryGiB,
        logicalCpus: machineConfig.hardware?.logicalCpus,
        agentTeamEnabled: machineConfig.agentTeamEnabled
    }) : "null";
    const workspaceJson = JSON.stringify(workspace ?? "");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgePilot</title><style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#172033;background:#f4f7fb}body{margin:0}.wrap{max-width:1120px;margin:auto;padding:28px}.hero{background:#111827;color:#fff;border-radius:18px;padding:28px;box-shadow:0 12px 32px #0002}.hero h1{margin:0 0 8px;font-size:34px}.hero p{margin:4px 0;color:#cbd5e1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin:18px 0}.card{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:18px;box-shadow:0 4px 18px #23304a0c}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#667085}.value{font-size:22px;font-weight:700;margin-top:5px}.ok{color:#18794e}.warn{color:#9a6700}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{display:inline-block;background:#fff;color:#111827;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;border:0;cursor:pointer}.btn.secondary{background:#263244;color:#fff}.cmd{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#0b1020;color:#d5e2ff;padding:12px;border-radius:9px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #e7ebf1;text-align:left}.PASS{font-weight:700;color:#18794e}.FAIL{font-weight:700;color:#b42318}.muted{color:#667085;font-size:13px}</style></head><body><div class="wrap">
<section class="hero"><h1>ForgePilot</h1><p>Verified local software-engineering agent.</p><p id="workspace"></p><div class="actions"><button class="btn" onclick="copyQuick()">Copy quick-run command</button><button class="btn secondary" onclick="location.reload()">Refresh</button></div></section>
<div class="grid"><div class="card"><div class="label">Machine tier</div><div class="value" id="tier">Not configured</div><div class="muted" id="hardware"></div></div><div class="card"><div class="label">Coding model</div><div class="value" id="model">—</div><div class="muted" id="vision"></div></div><div class="card"><div class="label">Agent team</div><div class="value" id="agents">—</div><div class="muted">Low-resource systems automatically reduce concurrency.</div></div></div>
<div class="card"><h2>Quick start</h2><p>Put a task JSON file in your workspace, then use the command below. ForgePilot automatically uses the machine profile chosen during installation.</p><div class="cmd" id="quick">forgepilot run task.json --workspace . --apply</div><p class="muted">For AI tasks, set <code>"planner":"ollama"</code> in the task JSON. Required task permissions still need explicit approval.</p></div>
<div class="card" style="margin-top:18px"><h2>Recent verified runs</h2><table><thead><tr><th>Time</th><th>Status</th><th>Goal</th><th>Version</th><th>Signed</th></tr></thead><tbody id="runs"></tbody></table></div>
<script>const cfg=${config};const workspace=${workspaceJson};document.querySelector('#workspace').textContent='Workspace: '+workspace;if(cfg){tier.textContent=cfg.tier||cfg.profile||'configured';hardware.textContent=(cfg.memoryGiB??'?')+' GiB RAM / '+(cfg.availableMemoryGiB??'?')+' GiB available / '+(cfg.logicalCpus??'?')+' CPUs';model.textContent=cfg.model||'—';vision.textContent='Vision: '+(cfg.visionModel||'disabled to save memory');agents.textContent=cfg.agentTeamEnabled?'ON':'OFF / low-resource mode'}fetch('/api/runs').then(r=>r.json()).then(rows=>{document.querySelector('#runs').innerHTML=rows.length?rows.map(x=>'<tr><td>'+esc(x.createdAt||'')+'</td><td class="'+esc(x.status||'')+'">'+esc(x.status||'')+'</td><td>'+esc(x.goal||'')+'</td><td>'+esc(x.version||'')+'</td><td>'+(x.signed?'✓':'—')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">No runs yet.</td></tr>'});function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function copyQuick(){navigator.clipboard?.writeText(document.querySelector('#quick').textContent)}</script></div></body></html>`;
}

export async function createDashboardServer({ workspace, host = "127.0.0.1", port = 3210, launcher = null } = {}) {
    if (!['127.0.0.1','localhost','::1'].includes(host)) throw new Error("ForgePilot dashboard is loopback-only.");
    const resolvedWorkspace = path.resolve(workspace ?? ".");
    const server = http.createServer(async (req, res) => {
        try {
            if (req.url === "/api/runs") {
                const runs = await listRuns(resolvedWorkspace);
                res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                res.end(JSON.stringify(runs));
                return;
            }
            if (req.url === "/api/system") {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                res.end(JSON.stringify(launcher?.machineConfig ?? null));
                return;
            }
            if (req.url === "/" || req.url === "/index.html") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
                res.end(html({ workspace: resolvedWorkspace, machineConfig: launcher?.machineConfig ?? null }));
                return;
            }
            res.writeHead(404); res.end("Not found");
        } catch (error) {
            res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error.message }));
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
    const address = server.address();
    return { server, host, port: typeof address === "object" && address ? address.port : port, workspace: resolvedWorkspace };
}
