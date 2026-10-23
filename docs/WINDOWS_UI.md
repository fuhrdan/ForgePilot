# Native Windows UI Automation (v0.9)

The `windows-ui` computer driver complements the v0.8 CDP driver for native Win32/WPF/WinForms applications.

## Architecture

ForgePilot invokes a fixed PowerShell program with `shell:false`. Action data is JSON in the `FORGEPILOT_UI_PAYLOAD` environment variable. The bridge loads .NET `UIAutomationClient`, `UIAutomationTypes`, `System.Windows.Forms`, and `System.Drawing`.

Supported v0.9 operations:

- accessibility/control-tree inspection;
- assertion by AutomationId/name;
- click/invoke by AutomationId/name;
- text entry through ValuePattern with SendKeys fallback;
- keyboard actions;
- bounded waits;
- primary-screen PNG screenshot capture.

CDP-style `selector` values are treated as AutomationIds by the native driver, so `"selector":"#saveButton"` maps to AutomationId `saveButton`.

## Deliberate limits

- Windows only.
- No arbitrary PowerShell supplied by an agent.
- No coordinate clicking in the native v0.9 driver.
- No browser navigation action; use CDP for browser navigation.
- Real native GUI control remains incompatible with `--sandbox` because a host desktop application can modify host resources outside a disposable container.

These constraints keep the native bridge auditable while leaving room for a brokered sandbox-to-desktop architecture after v1.0.
