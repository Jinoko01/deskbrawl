param(
    [Parameter(Mandatory)][int]$AppProcessId,
    [ValidateSet('state', 'show', 'hide', 'effects', 'exit', 'play')][string]$Action = 'state'
)
. "$PSScriptRoot/test-window-lifecycle.ps1" -HelpersOnly
$app = Get-Process -Id $AppProcessId
$overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
if ($Action -eq 'state') {
    @{ visible = $overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($overlay)
       coversPrimary = $overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::CoversPrimaryMonitor($overlay)
       foreground = [DeskBrawl.WindowTest]::GetForegroundWindow().ToInt64()
    } | ConvertTo-Json -Compress
    return
}
if ($Action -eq 'play') {
    # The real global shortcut: Ctrl+Shift+G.
    foreach ($key in 0x11, 0x10, 0x47) { [DeskBrawl.WindowTest]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }
    foreach ($key in 0x47, 0x10, 0x11) { [DeskBrawl.WindowTest]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }
    return
}
$commands = Get-TrayCommands $app
$tray = [DeskBrawl.WindowTest]::FindClass($app.Id, 'tray_icon_app')
$label = @{ show = '오버레이 표시'; hide = '오버레이 숨김'; effects = '효과 감소'; exit = '종료' }[$Action]
Assert ($commands.ContainsKey($label)) "Missing tray command: $label"
[DeskBrawl.WindowTest]::Command($tray, $commands[$label])
