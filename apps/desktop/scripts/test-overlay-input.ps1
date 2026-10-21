param(
    [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\src-tauri\target\release\deskbrawl.exe')
)

. "$PSScriptRoot/test-window-lifecycle.ps1" -ExecutablePath $ExecutablePath -HelpersOnly
Add-Type -AssemblyName System.Windows.Forms
$previousDpiContext = [DeskBrawl.WindowTest]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))

function Wait-Input([scriptblock]$InputCondition, [string]$Message) {
    Wait-Until {
        [Windows.Forms.Application]::DoEvents()
        & $InputCondition
    } $Message
}

function Assert-InputFocus([IntPtr]$Window) {
    Assert ([DeskBrawl.WindowTest]::GetForegroundWindow() -eq $Window) 'Input test receiver lost focus; refusing to send input.'
}

$receiver = [Windows.Forms.Form]::new()
$receiver.Text = 'DeskBrawl input test'
$receiver.StartPosition = 'Manual'
$receiver.Location = [Drawing.Point]::new(100, 100)
$receiver.ClientSize = [Drawing.Size]::new(400, 250)
$receiver.KeyPreview = $true
$receiver.TopMost = $true
$receivedInput = @{ Left = 0; Right = 0; Drag = 0; Wheel = 0; Key = 0 }
$mouseReleaseFlags = 0
$keyHeld = $false
$cursorMoved = $false
$receiver.Add_MouseDown({
    param($sender, $mouse)
    if ($mouse.Button -eq [Windows.Forms.MouseButtons]::Left) { $receivedInput.Left++ }
    if ($mouse.Button -eq [Windows.Forms.MouseButtons]::Right) { $receivedInput.Right++ }
})
$receiver.Add_MouseMove({
    param($sender, $mouse)
    if ($mouse.Button -eq [Windows.Forms.MouseButtons]::Left) { $receivedInput.Drag++ }
})
$receiver.Add_MouseWheel({ $receivedInput.Wheel++ })
$receiver.Add_KeyDown({
    param($sender, $key)
    if ($key.KeyCode -eq [Windows.Forms.Keys]::A) { $receivedInput.Key++ }
})

$originalCursor = [DeskBrawl.WindowTest+Point]::new()
[void][DeskBrawl.WindowTest]::GetCursorPos([ref]$originalCursor)
$originalFocus = [DeskBrawl.WindowTest]::GetForegroundWindow()
$app = Start-Process -FilePath $ExecutablePath -PassThru
try {
    Wait-Until {
        $overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
        $overlay -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($overlay)
    } 'Overlay did not finish initialization.'
    $overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
    $commands = Get-TrayCommands $app
    $tray = [DeskBrawl.WindowTest]::FindClass($app.Id, 'tray_icon_app')

    $receiver.Show()
    [Windows.Forms.Application]::DoEvents()
    [DeskBrawl.WindowTest]::PlaceTopmost($receiver.Handle, $receiver.Left, $receiver.Top)
    [DeskBrawl.WindowTest]::PlaceTopmost($overlay, $receiver.Left, $receiver.Top)
    $point = $receiver.PointToScreen([Drawing.Point]::new(120, 100))
    Wait-Input { [DeskBrawl.WindowTest]::InputTarget($point.X, $point.Y) -eq $receiver.Handle } 'The disposable receiver must be the Windows input target under overlay.'
    $cursorMoved = $true
    [void][DeskBrawl.WindowTest]::SetCursorPos($point.X, $point.Y)
    if ([DeskBrawl.WindowTest]::GetForegroundWindow() -ne $receiver.Handle) {
        # Activate only the verified disposable receiver through a normal mouse click.
        $mouseReleaseFlags = 0x0004
        [DeskBrawl.WindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [DeskBrawl.WindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        $mouseReleaseFlags = 0
    }
    Wait-Input { [DeskBrawl.WindowTest]::GetForegroundWindow() -eq $receiver.Handle } 'Could not focus the input receiver.'
    Assert-InputFocus $receiver.Handle

    # Send real desktop input only while our disposable receiver owns keyboard focus.
    $mouseReleaseFlags = 0x0004
    [DeskBrawl.WindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Wait-Input { $receivedInput.Left -gt 0 } 'Left click did not pass through overlay.'
    Assert-InputFocus $receiver.Handle
    [void][DeskBrawl.WindowTest]::SetCursorPos($point.X + 30, $point.Y + 20)
    Wait-Input { $receivedInput.Drag -gt 0 } 'Drag did not pass through overlay.'
    [DeskBrawl.WindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $mouseReleaseFlags = 0
    Assert-InputFocus $receiver.Handle
    $mouseReleaseFlags = 0x0010
    [DeskBrawl.WindowTest]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
    [DeskBrawl.WindowTest]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    $mouseReleaseFlags = 0
    Wait-Input { $receivedInput.Right -gt 0 } 'Right click did not pass through overlay.'
    Assert-InputFocus $receiver.Handle
    [DeskBrawl.WindowTest]::mouse_event(0x0800, 0, 0, 120, [UIntPtr]::Zero)
    Wait-Input { $receivedInput.Wheel -gt 0 } 'Wheel input did not pass through overlay.'
    Assert-InputFocus $receiver.Handle
    $keyHeld = $true
    [DeskBrawl.WindowTest]::keybd_event(0x41, 0, 0, [UIntPtr]::Zero)
    [DeskBrawl.WindowTest]::keybd_event(0x41, 0, 0x0002, [UIntPtr]::Zero)
    $keyHeld = $false
    Wait-Input { $receivedInput.Key -gt 0 } 'Keyboard input did not remain with the receiver.'

    for ($cycle = 0; $cycle -lt 3; $cycle++) {
        Assert-InputFocus $receiver.Handle
        [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 숨김'])
        Wait-Input { -not [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Repeated hide failed.'
        [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
        Wait-Input { [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Repeated show failed.'
        Assert-InputFocus $receiver.Handle
    }

    [DeskBrawl.WindowTest]::Close($overlay)
    Wait-Input { -not [DeskBrawl.WindowTest]::IsWindow($overlay) } 'Overlay did not close.'
    [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
    Wait-Input {
        $replacement = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
        $replacement -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($replacement)
    } 'Tray could not recreate the closed overlay.'
    Assert-InputFocus $receiver.Handle
    $replacement = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
    Assert (([DeskBrawl.WindowTest]::GetWindowLong($replacement, -20) -band 0x08080020) -eq 0x08080020) 'Recreated overlay must retain click-through and no-activate flags.'

    [DeskBrawl.WindowTest]::Command($tray, $commands['종료'])
    Assert ($app.WaitForExit(10000)) 'Tray exit must terminate the app.'
    Assert ($app.ExitCode -eq 0) 'Tray exit must succeed.'
    Write-Output 'PASS: left/right click, drag, wheel, keyboard, focus preservation, repeated tray control, recreation and exit'
}
finally {
    if ($mouseReleaseFlags -ne 0) { [DeskBrawl.WindowTest]::mouse_event($mouseReleaseFlags, 0, 0, 0, [UIntPtr]::Zero) }
    if ($keyHeld) { [DeskBrawl.WindowTest]::keybd_event(0x41, 0, 0x0002, [UIntPtr]::Zero) }
    $restoreFocus = [DeskBrawl.WindowTest]::GetForegroundWindow() -eq $receiver.Handle
    $receiver.Close()
    $receiver.Dispose()
    if ($cursorMoved) { [void][DeskBrawl.WindowTest]::SetCursorPos($originalCursor.X, $originalCursor.Y) }
    if ($restoreFocus -and [DeskBrawl.WindowTest]::IsWindow($originalFocus)) {
        [void][DeskBrawl.WindowTest]::SetForegroundWindow($originalFocus)
    }
    if (-not $app.HasExited) {
        $app.Kill()
        $app.WaitForExit()
    }
    $app.Dispose()
    if ($previousDpiContext -ne [IntPtr]::Zero) {
        [void][DeskBrawl.WindowTest]::SetThreadDpiAwarenessContext($previousDpiContext)
    }
}
