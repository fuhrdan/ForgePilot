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

function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgePilot Dashboard</title><style>body{font:15px system-ui;margin:32px;max-width:1100px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #ccc;text-align:left}.PASS{font-weight:700}.FAIL{font-weight:700}</style></head><body><h1>ForgePilot Dashboard</h1><p>Local run history and signed provenance status.</p><table><thead><tr><th>Time</th><th>Status</th><th>Goal</th><th>Version</th><th>Signed</th></tr></thead><tbody id="runs"></tbody></table><script>fetch('/api/runs').then(r=>r.json()).then(rows=>{document.querySelector('#runs').innerHTML=rows.map(x=>'<tr><td>'+esc(x.createdAt||'')+'</td><td class="'+esc(x.status||'')+'">'+esc(x.status||'')+'</td><td>'+esc(x.goal||'')+'</td><td>'+esc(x.version||'')+'</td><td>'+(x.signed?'✓':'—')+'</td></tr>').join('')});function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</script></body></html>`;
}

export async function createDashboardServer({ workspace, host = "127.0.0.1", port = 3210 } = {}) {
    const resolvedWorkspace = path.resolve(workspace ?? ".");
    const server = http.createServer(async (req, res) => {
        try {
            if (req.url === "/api/runs") {
                const runs = await listRuns(resolvedWorkspace);
                res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                res.end(JSON.stringify(runs));
                return;
            }
            if (req.url === "/" || req.url === "/index.html") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
                res.end(html());
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
