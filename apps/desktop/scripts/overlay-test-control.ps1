param(
    [Parameter(Mandatory)][int]$AppProcessId,
    [ValidateSet('state', 'show', 'hide', 'effects', 'exit', 'play', 'play-tray', 'home', 'focus', 'copy', 'close-home', 'minimize-home', 'assert-exited')][string]$Action = 'state'
)
. "$PSScriptRoot/test-window-lifecycle.ps1" -HelpersOnly
if ($Action -eq 'assert-exited') {
    Assert ($null -eq (Get-Process -Id $AppProcessId -ErrorAction SilentlyContinue)) 'App process must exit.'
    Assert ([DeskBrawl.WindowTest]::Find($AppProcessId, 'DeskBrawl Overlay') -eq [IntPtr]::Zero) 'Character overlay must be removed.'
    Assert ([DeskBrawl.WindowTest]::FindClass($AppProcessId, 'tray_icon_app') -eq [IntPtr]::Zero) 'Tray window must be removed.'
    return
}
$app = Get-Process -Id $AppProcessId
$overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
$main = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl')
if ($Action -eq 'state') {
    @{ visible = $overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($overlay)
       coversPrimary = $overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::CoversPrimaryMonitor($overlay)
       foreground = [DeskBrawl.WindowTest]::GetForegroundWindow().ToInt64()
       mainVisible = $main -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($main)
       mainMinimized = $main -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsIconic($main)
    } | ConvertTo-Json -Compress
    return
}
if ($Action -eq 'close-home') {
    [DeskBrawl.WindowTest]::Close($main)
    return
}
if ($Action -eq 'minimize-home') {
    [DeskBrawl.WindowTest]::Minimize($main)
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
$label = @{ show = '오버레이 표시'; hide = '오버레이 숨김'; effects = '효과 감소'; exit = '종료'; 'play-tray' = '플레이 시작'; home = '홈 열기'; focus = '집중 모드'; copy = '링크 복사' }[$Action]
Assert ($commands.ContainsKey($label)) "Missing tray command: $label"
[DeskBrawl.WindowTest]::Command($tray, $commands[$label])
