param(
    [Parameter(Mandatory)][int]$AppProcessId,
    [ValidateSet('state', 'show', 'hide', 'effects', 'exit', 'play', 'play-tray', 'home', 'focus', 'copy', 'close-home', 'minimize-home', 'assert-exited', 'drag')][string]$Action = 'state',
    [int]$FromX, [int]$FromY, [int]$ToX, [int]$ToY,
    [switch]$Relative
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
if ($Action -eq 'drag') {
    Assert ($overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($overlay)) 'Owned test overlay must be visible.'
    $previousDpi = [DeskBrawl.WindowTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $cursor = New-Object DeskBrawl.WindowTest+Point
    [void][DeskBrawl.WindowTest]::GetCursorPos([ref]$cursor)
    try {
        [void][DeskBrawl.WindowTest]::SetCursorPos($FromX, $FromY)
        [DeskBrawl.WindowTest]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 40
        if ($Relative) {
            # Relative hardware-style moves must accumulate while the button is held.
            # A single SetCursorPos jump misses hooks that freeze the Windows cursor.
            for ($step = 0; $step -lt 12; $step++) {
                [DeskBrawl.WindowTest]::mouse_event(1, [uint32][Math]::Round(($ToX - $FromX) / 12), [uint32][Math]::Round(($ToY - $FromY) / 12), 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 25
            }
            $end = New-Object DeskBrawl.WindowTest+Point
            [void][DeskBrawl.WindowTest]::GetCursorPos([ref]$end)
            @{ x = $end.X; y = $end.Y } | ConvertTo-Json -Compress
        } else {
            [void][DeskBrawl.WindowTest]::SetCursorPos($ToX, $ToY)
            Start-Sleep -Milliseconds 40
        }
    } finally {
        [DeskBrawl.WindowTest]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        [void][DeskBrawl.WindowTest]::SetCursorPos($cursor.X, $cursor.Y)
        [void][DeskBrawl.WindowTest]::SetThreadDpiAwarenessContext($previousDpi)
    }
    return
}
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
