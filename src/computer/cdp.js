import fs from "node:fs/promises";

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class CdpClient {
    constructor({ endpoint = "http://127.0.0.1:9222", targetHint = null, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
        this.endpoint = endpoint.replace(/\/$/, "");
        this.targetHint = targetHint;
        this.fetchImpl = fetchImpl;
        this.WebSocketImpl = WebSocketImpl;
        this.socket = null;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        if (!this.WebSocketImpl) throw new Error("WebSocket is unavailable in this Node runtime.");
        const response = await this.fetchImpl(`${this.endpoint}/json/list`);
        if (!response.ok) throw new Error(`CDP target discovery failed: HTTP ${response.status}`);
        const targets = await response.json();
        const pages = targets.filter((item) => item.webSocketDebuggerUrl && ["page", "webview"].includes(item.type));
        const hint = String(this.targetHint ?? "").toLowerCase();
        const target = (hint ? pages.find((item) => `${item.title ?? ""} ${item.url ?? ""}`.toLowerCase().includes(hint)) : null) ?? pages[0];
        if (!target) throw new Error("No debuggable page target was found at the CDP endpoint.");
        await new Promise((resolve, reject) => {
            const socket = new this.WebSocketImpl(target.webSocketDebuggerUrl);
            this.socket = socket;
            const timer = setTimeout(() => reject(new Error("Timed out connecting to CDP WebSocket.")), 10000);
            socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
            socket.addEventListener("error", (event) => { clearTimeout(timer); reject(new Error(`CDP WebSocket error: ${event?.message ?? "unknown"}`)); }, { once: true });
            socket.addEventListener("message", (event) => this.#onMessage(event));
            socket.addEventListener("close", () => {
                for (const item of this.pending.values()) item.reject(new Error("CDP connection closed."));
                this.pending.clear();
            });
        });
        await this.send("Page.enable");
        await this.send("Runtime.enable");
        await this.send("DOM.enable");
        await this.send("Accessibility.enable");
        return target;
    }

    #onMessage(event) {
        let message;
        try { message = JSON.parse(String(event.data)); }
        catch { return; }
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? "CDP request failed."));
        else pending.resolve(message.result ?? {});
    }

    send(method, params = {}, timeoutMs = 15000) {
        if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) throw new Error("CDP session is not connected.");
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP command timed out: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); }
            });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async close() {
        try { this.socket?.close(); } catch {}
        this.socket = null;
    }
}

function axValue(value) {
    if (!value) return null;
    if (Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
    return null;
}

export class CdpComputerDriver {
    constructor(options = {}) {
        this.options = options;
        this.client = options.client ?? new CdpClient(options);
        this.target = null;
    }

    async start() {
        this.target = await this.client.connect();
        return { targetId: this.target.id, title: this.target.title ?? "", url: this.target.url ?? "" };
    }

    async currentUrl() {
        const result = await this.client.send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
        return String(result.result?.value ?? this.target?.url ?? "");
    }

    async perform(action) {
        if (action.type === "computer_navigate") {
            const navigation = await this.client.send("Page.navigate", { url: action.url });
            if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
            await delay(Number(action.waitMs ?? 250));
            return { url: action.url, frameId: navigation.frameId ?? null };
        }
        if (action.type === "computer_inspect") {
            const result = await this.client.send("Accessibility.getFullAXTree");
            const maxNodes = Math.max(1, Math.min(1000, Number(action.maxNodes ?? 200)));
            const nodes = (result.nodes ?? []).slice(0, maxNodes).map((node) => ({
                nodeId: node.nodeId,
                role: axValue(node.role),
                name: axValue(node.name),
                value: axValue(node.value),
                ignored: Boolean(node.ignored)
            }));
            return { kind: "accessibility", nodes, truncated: (result.nodes?.length ?? 0) > nodes.length };
        }
        if (action.type === "computer_assert") {
            const result = await this.client.send("Accessibility.getFullAXTree");
            const nodes = (result.nodes ?? []).map((node) => ({
                role: axValue(node.role),
                name: axValue(node.name),
                value: axValue(node.value),
                ignored: Boolean(node.ignored)
            }));
            const role = action.role == null ? null : String(action.role);
            const name = action.name == null ? null : String(action.name);
            const contains = action.contains == null ? null : String(action.contains);
            const value = action.value == null ? null : String(action.value);
            const matches = nodes.filter((node) => {
                if (role !== null && node.role !== role) return false;
                if (name !== null && node.name !== name) return false;
                if (value !== null && String(node.value ?? "") !== value) return false;
                if (contains !== null && !`${node.name ?? ""} ${node.value ?? ""}`.includes(contains)) return false;
                return true;
            });
            if (matches.length === 0) throw new Error(`Accessibility assertion failed: ${JSON.stringify({ role, name, value, contains })}`);
            return { matched: true, matchCount: matches.length, query: { role, name, value, contains } };
        }
        if (action.type === "computer_click") {
            let x = Number(action.x);
            let y = Number(action.y);
            if (action.selector) {
                const expression = `(() => { const e=document.querySelector(${JSON.stringify(action.selector)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`;
                const found = await this.client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
                const point = found.result?.value;
                if (!point) throw new Error(`Selector not found: ${action.selector}`);
                x = point.x; y = point.y;
            }
            await this.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: action.button ?? "left", clickCount: Number(action.clickCount ?? 1) });
            await this.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: action.button ?? "left", clickCount: Number(action.clickCount ?? 1) });
            return { x, y };
        }
        if (action.type === "computer_type") {
            const selector = JSON.stringify(action.selector);
            const focused = await this.client.send("Runtime.evaluate", {
                expression: `(() => { const e=document.querySelector(${selector}); if(!e) return false; e.focus(); return true; })()`,
                returnByValue: true
            });
            if (!focused.result?.value) throw new Error(`Selector not found: ${action.selector}`);
            if (action.clear === true) {
                await this.client.send("Runtime.evaluate", { expression: `(() => { const e=document.querySelector(${selector}); if('value' in e) e.value=''; else e.textContent=''; e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()` });
            }
            await this.client.send("Input.insertText", { text: String(action.text ?? "") });
            return { typedChars: String(action.text ?? "").length };
        }
        if (action.type === "computer_key") {
            const key = String(action.key ?? "");
            if (!key) throw new Error("computer_key requires key.");
            await this.client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: action.code ?? undefined, modifiers: Number(action.modifiers ?? 0) });
            await this.client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: action.code ?? undefined, modifiers: Number(action.modifiers ?? 0) });
            return { key };
        }
        if (action.type === "computer_wait") {
            const ms = Number(action.ms ?? 0);
            await delay(ms);
            return { waitedMs: ms };
        }
        if (action.type === "computer_screenshot") {
            const result = await this.client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: Boolean(action.captureBeyondViewport) }, 30000);
            const bytes = Buffer.from(result.data, "base64");
            if (action.outputPath) await fs.writeFile(action.outputPath, bytes);
            return { bytes: bytes.length, outputPath: action.outputPath ?? null };
        }
        throw new Error(`Unsupported CDP action: ${action.type}`);
    }

    async stop() { await this.client.close(); }
    describe() { return { kind: "cdp", endpoint: this.options.endpoint ?? "http://127.0.0.1:9222", targetHint: this.options.targetHint ?? null }; }
}
