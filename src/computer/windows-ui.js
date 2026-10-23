import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function runProcess(command, args, { env = {}, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { shell: false, windowsHide: true, env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut) return reject(new Error("Windows UI bridge timed out."));
            if ((code ?? -1) !== 0) return reject(new Error(stderr.trim() || `Windows UI bridge exited ${code}.`));
            resolve(stdout);
        });
    });
}

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$payload = $env:FORGEPILOT_UI_PAYLOAD | ConvertFrom-Json
function Find-Element($p) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $idCondition = $null
  $nameCondition = $null
  if ($p.automationId) { $idCondition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList ([System.Windows.Automation.AutomationElement]::AutomationIdProperty,[string]$p.automationId) }
  if ($p.name) { $nameCondition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList ([System.Windows.Automation.AutomationElement]::NameProperty,[string]$p.name) }
  if (-not $idCondition -and -not $nameCondition) { throw 'Windows UI action requires automationId or name.' }
  $condition = if ($idCondition) { $idCondition } else { $nameCondition }
  $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
  if ($element -and $p.name -and ([string]$element.Current.Name -ne [string]$p.name)) { throw 'Windows UI element AutomationId matched but name did not.' }
  return $element
}
$result = $null
switch ($payload.type) {
  'computer_inspect' {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = New-Object System.Collections.Queue
    $top = $walker.GetFirstChild($root)
    while ($top) { $queue.Enqueue($top); $top = $walker.GetNextSibling($top) }
    $nodes = @()
    $rawLimit = if ($null -ne $payload.maxNodes) { [int]$payload.maxNodes } else { 200 }
    $limit = [Math]::Min($rawLimit, 1000)
    while ($queue.Count -gt 0 -and $nodes.Count -lt $limit) {
      $e = $queue.Dequeue()
      try {
        $nodes += [pscustomobject]@{ name=$e.Current.Name; automationId=$e.Current.AutomationId; controlType=$e.Current.ControlType.ProgrammaticName; enabled=$e.Current.IsEnabled }
      } catch {}
      try { $child = $walker.GetFirstChild($e); while ($child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) } } catch {}
    }
    $result = [pscustomobject]@{ nodes=$nodes }
  }
  'computer_assert' {
    $e = Find-Element $payload
    if (-not $e) { throw 'Requested Windows UI element was not found.' }
    if ($payload.contains -and -not ([string]$e.Current.Name).Contains([string]$payload.contains)) { throw 'Windows UI assertion failed.' }
    $result = [pscustomobject]@{ matched=$true; name=$e.Current.Name; automationId=$e.Current.AutomationId; controlType=$e.Current.ControlType.ProgrammaticName }
  }
  'computer_click' {
    $e = Find-Element $payload
    if (-not $e) { throw 'Requested Windows UI element was not found.' }
    $pattern = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke() }
    elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select() }
    else { $e.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
    $result = [pscustomobject]@{ clicked=$true; name=$e.Current.Name }
  }
  'computer_type' {
    $e = Find-Element $payload
    if (-not $e) { throw 'Requested Windows UI element was not found.' }
    $e.SetFocus()
    $pattern = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $pattern.SetValue([string]$payload.text) }
    else { throw 'Target does not expose UI Automation ValuePattern; native text entry refused rather than using ambiguous SendKeys text semantics.' }
    $result = [pscustomobject]@{ typedChars=([string]$payload.text).Length }
  }
  'computer_key' {
    $keyName = [string]$payload.key
    $keyMap = @{ 'Enter'='{ENTER}'; 'Tab'='{TAB}'; 'Escape'='{ESC}'; 'Esc'='{ESC}'; 'Backspace'='{BACKSPACE}'; 'Delete'='{DELETE}'; 'Up'='{UP}'; 'Down'='{DOWN}'; 'Left'='{LEFT}'; 'Right'='{RIGHT}'; 'Home'='{HOME}'; 'End'='{END}'; 'PageUp'='{PGUP}'; 'PageDown'='{PGDN}' }
    $send = if ($keyMap.ContainsKey($keyName)) { $keyMap[$keyName] } else { $keyName }
    [System.Windows.Forms.SendKeys]::SendWait($send)
    $result = [pscustomobject]@{ key=$keyName }
  }
  'computer_screenshot' {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
    $bmp.Save([string]$payload.outputPath,[System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $result = [pscustomobject]@{ outputPath=[string]$payload.outputPath; width=$bounds.Width; height=$bounds.Height }
  }
  default { throw ('Unsupported Windows UI action: ' + $payload.type) }
}
$result | ConvertTo-Json -Depth 8 -Compress
`;

function encodedCommand(script = POWERSHELL_SCRIPT) {
    return Buffer.from(script, "utf16le").toString("base64");
}

export class WindowsUiComputerDriver {
    constructor({ powershell = "powershell.exe", platform = process.platform, runner = runProcess } = {}) {
        this.powershell = powershell;
        this.platform = platform;
        this.runner = runner;
    }

    describe() { return { kind: "windows-ui", native: true, platform: this.platform }; }

    async start() {
        if (this.platform !== "win32") throw new Error("The windows-ui computer driver is only available on Windows.");
        return { desktop: "windows-ui" };
    }

    async perform(action) {
        if (action.type === "computer_wait") {
            await new Promise((resolve) => setTimeout(resolve, Number(action.ms ?? 0)));
            return { waitedMs: Number(action.ms ?? 0) };
        }
        if (action.type === "computer_navigate") throw new Error("computer_navigate is not supported by the native Windows UI driver; launch/navigate the application through an approved command or use CDP for browsers.");
        if (action.type === "computer_click" && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y)) && !action.selector && !action.name && !action.automationId) {
            throw new Error("Coordinate clicking is intentionally unavailable in the v0.9 Windows UI driver; use AutomationId/name selectors for auditable native control.");
        }
        if (action.type === "computer_screenshot") await fs.mkdir(path.dirname(action.outputPath), { recursive: true });
        const payload = { ...action };
        // CDP CSS selectors have no stable equivalent in UI Automation; treat selector as AutomationId for native tasks.
        if (payload.selector && !payload.automationId) payload.automationId = payload.selector.replace(/^#/, "");
        const stdout = await this.runner(this.powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand()], {
            env: { FORGEPILOT_UI_PAYLOAD: JSON.stringify(payload) },
            timeoutMs: Number(action.timeoutMs ?? 30000)
        });
        const text = String(stdout ?? "").trim();
        return text ? JSON.parse(text) : {};
    }

    async stop() {}
}

export { POWERSHELL_SCRIPT as WINDOWS_UI_BRIDGE_SCRIPT, encodedCommand as encodeWindowsUiBridge };
