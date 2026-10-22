param(
    [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\src-tauri\target\release\deskbrawl.exe'),
    [switch]$HelpersOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'This check requires Windows.'
}
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path

if (-not ('DeskBrawl.WindowTest' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

namespace DeskBrawl {
    public static class WindowTest {
        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct Point { public int X, Y; }
        private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr window, int index);
        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int count, uint flags);
        [DllImport("user32.dll")]
        private static extern uint GetMenuItemID(IntPtr menu, int position);
        [DllImport("user32.dll")]
        private static extern int GetMenuItemCount(IntPtr menu);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")]
        public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out Point point);
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern uint RegisterWindowMessage(string name);
        [DllImport("user32.dll")]
        private static extern uint GetMenuState(IntPtr menu, uint item, uint flags);

        public static bool MenuChecked(IntPtr popup, uint command) {
            var menu = SendMessage(popup, 0x01E1, IntPtr.Zero, IntPtr.Zero);
            return (GetMenuState(menu, command, 0) & 8) != 0;
        }

        public static void NotifyDisplayChange(IntPtr window) {
            PostMessage(window, 0x007E, new IntPtr(32), IntPtr.Zero);
        }

        public static void NotifyShellRestart(IntPtr window) {
            PostMessage(window, RegisterWindowMessage("TaskbarCreated"), IntPtr.Zero, IntPtr.Zero);
        }

        public static bool CoversPrimaryMonitor(IntPtr window) {
            Rect rect;
            return GetWindowRect(window, out rect) && rect.Left == 0 && rect.Top == 0
                && rect.Right == GetSystemMetrics(0) && rect.Bottom == GetSystemMetrics(1);
        }

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);

        public static IntPtr Find(int processId, string title) {
            return FindWindow(processId, title, false);
        }

        public static IntPtr FindClass(int processId, string name) {
            return FindWindow(processId, name, true);
        }

        private static IntPtr FindWindow(int processId, string name, bool byClass) {
            IntPtr result = IntPtr.Zero;
            EnumWindows((window, parameter) => {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner != processId) return true;
                var text = new StringBuilder(256);
                if (byClass) GetClassName(window, text, text.Capacity);
                else GetWindowText(window, text, text.Capacity);
                if (text.ToString() != name) return true;
                result = window;
                return false;
            }, IntPtr.Zero);
            return result;
        }

        public static void Close(IntPtr window) {
            if (!PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }

        public static void Minimize(IntPtr window) {
            if (!PostMessage(window, 0x0112, new IntPtr(0xF020), IntPtr.Zero)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }

        public static void OpenTrayMenu(IntPtr tray) {
            // Native callback message of the pinned tray-icon 0.25.1 Windows backend.
            PostMessage(tray, 6002, IntPtr.Zero, new IntPtr(0x0205));
        }

        public static Dictionary<string, uint> ReadMenu(IntPtr popup) {
            var menu = SendMessage(popup, 0x01E1, IntPtr.Zero, IntPtr.Zero);
            var commands = new Dictionary<string, uint>();
            for (int i = 0; i < GetMenuItemCount(menu); i++) {
                var text = new StringBuilder(256);
                GetMenuString(menu, (uint)i, text, text.Capacity, 0x0400);
                commands[text.ToString()] = GetMenuItemID(menu, i);
            }
            return commands;
        }

        public static void DismissMenu(IntPtr tray) {
            PostMessage(tray, 0x001F, IntPtr.Zero, IntPtr.Zero);
        }

        public static void Command(IntPtr tray, uint command) {
            PostMessage(tray, 0x0111, new IntPtr(command), IntPtr.Zero);
        }

        public static void NotifyFocus(IntPtr window) {
            PostMessage(window, 0x0086, new IntPtr(1), IntPtr.Zero);
            PostMessage(window, 0x0007, IntPtr.Zero, IntPtr.Zero);
        }

        public static void NotifyBlur(IntPtr window) {
            PostMessage(window, 0x0008, IntPtr.Zero, IntPtr.Zero);
            PostMessage(window, 0x0086, IntPtr.Zero, IntPtr.Zero);
        }

        public static void PlaceTopmost(IntPtr window, int x, int y) {
            if (!SetWindowPos(window, new IntPtr(-1), x, y, 0, 0, 0x0011))
                throw new System.ComponentModel.Win32Exception();
        }

        public static IntPtr InputTarget(int x, int y) {
            return GetAncestor(WindowFromPoint(new Point { X = x, Y = y }), 2);
        }

        public static bool HasNoFrame(IntPtr window) {
            Rect outer, client;
            // tao removes the frame through WM_NCCALCSIZE while retaining WS_CAPTION.
            // Recalculate it without showing, moving, resizing or activating the hidden window.
            if (!SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x0037)) return false;
            return GetWindowRect(window, out outer) && GetClientRect(window, out client)
                && outer.Right - outer.Left == client.Right - client.Left
                && outer.Bottom - outer.Top == client.Bottom - client.Top;
        }
    }
}
'@
}

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Wait-Until([scriptblock]$Condition, [string]$Message) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (& $Condition)) {
        if ($timer.Elapsed.TotalSeconds -ge 10) { throw $Message }
        Start-Sleep -Milliseconds 50
    }
}

function Get-TrayCommands([Diagnostics.Process]$App) {
    $tray = [DeskBrawl.WindowTest]::FindClass($App.Id, 'tray_icon_app')
    Assert ($tray -ne [IntPtr]::Zero) 'The native tray icon window must exist.'
    try {
        [DeskBrawl.WindowTest]::OpenTrayMenu($tray)
        Wait-Until { [DeskBrawl.WindowTest]::FindClass($App.Id, '#32768') -ne [IntPtr]::Zero } 'Tray menu did not open.'
        $popup = [DeskBrawl.WindowTest]::FindClass($App.Id, '#32768')
        return [DeskBrawl.WindowTest]::ReadMenu($popup)
    }
    finally {
        [DeskBrawl.WindowTest]::DismissMenu($tray)
    }
}

if ($HelpersOnly) { return }

foreach ($scenario in @('main', 'overlay', 'tray')) {
    $closeOverlayFirst = $scenario -ne 'main'
    # The desktop target must start normally so main visibility can be checked.
    $app = Start-Process -FilePath $ExecutablePath -PassThru
    try {
        Wait-Until {
            $app.HasExited -or (
                [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl') -ne [IntPtr]::Zero -and
                [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay') -ne [IntPtr]::Zero
            )
        } 'The two native windows were not created.'
        Assert (-not $app.HasExited) 'The app exited during startup.'
        $main = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl')
        $overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')

        Wait-Until { [DeskBrawl.WindowTest]::IsWindowVisible($main) } 'Main must be visible.'
        Wait-Until { [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Overlay must show after safe initialization.'
        $style = [DeskBrawl.WindowTest]::GetWindowLong($overlay, -16)
        $extendedStyle = [DeskBrawl.WindowTest]::GetWindowLong($overlay, -20)
        Assert (-not [DeskBrawl.WindowTest]::HasNoFrame($main)) 'Main must retain its normal frame.'
        Assert ([DeskBrawl.WindowTest]::HasNoFrame($overlay)) 'Overlay must have no frame outside its client area.'
        Assert ([DeskBrawl.WindowTest]::IsWindowVisible($overlay)) 'Frame recalculation must preserve overlay visibility.'
        Assert ([DeskBrawl.WindowTest]::CoversPrimaryMonitor($overlay)) 'Overlay must cover the complete primary monitor.'
        Assert (($extendedStyle -band 0x00040000) -eq 0) 'Overlay must not appear as a normal taskbar window.'
        Assert (($style -band 0x00040000) -eq 0) 'Overlay must not be resizable.'
        Assert (($extendedStyle -band 0x00000008) -ne 0) 'Overlay must be topmost.'
        Assert (($extendedStyle -band 0x08000000) -ne 0) 'Overlay must not activate.'
        Assert (($extendedStyle -band 0x00080020) -eq 0x00080020) 'Overlay must have native layered and click-through flags.'

        $commands = Get-TrayCommands $app
        $tray = [DeskBrawl.WindowTest]::FindClass($app.Id, 'tray_icon_app')
        Assert ($commands.ContainsKey('오버레이 표시') -and $commands.ContainsKey('오버레이 숨김') -and $commands.ContainsKey('종료')) 'Tray commands must exist.'
        Assert ($commands.ContainsKey('효과 감소')) 'Reduced effects preference must be available.'
        foreach ($change in @('display', 'shell')) {
            if ($change -eq 'display') { [DeskBrawl.WindowTest]::NotifyDisplayChange($overlay) }
            else { [DeskBrawl.WindowTest]::NotifyShellRestart($overlay) }
            Wait-Until { -not [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Display/shell changes must hide the overlay safely.'
            $foreground = [DeskBrawl.WindowTest]::GetForegroundWindow()
            [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
            Wait-Until {
                $current = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
                $current -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($current)
            } 'Tray must recreate after display/shell change.'
            $overlay = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
            Assert ([DeskBrawl.WindowTest]::CoversPrimaryMonitor($overlay)) 'Recovered overlay must remeasure the primary monitor.'
            Assert ([DeskBrawl.WindowTest]::GetForegroundWindow() -eq $foreground) 'Display recovery must preserve focus.'
        }
        [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 숨김'])
        Wait-Until { -not [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Tray hide failed.'
        $foregroundBeforeShow = [DeskBrawl.WindowTest]::GetForegroundWindow()
        [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
        Wait-Until { [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Tray show failed.'
        Assert ([DeskBrawl.WindowTest]::GetForegroundWindow() -eq $foregroundBeforeShow) 'Showing overlay must preserve foreground focus.'
        [DeskBrawl.WindowTest]::NotifyFocus($overlay)
        Wait-Until { -not [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Unexpected focus must hide the overlay.'
        [DeskBrawl.WindowTest]::NotifyBlur($overlay)
        [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
        Wait-Until { [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Tray must recover a suspended overlay.'

        if ($closeOverlayFirst) {
            [DeskBrawl.WindowTest]::Close($overlay)
            Wait-Until { -not [DeskBrawl.WindowTest]::IsWindow($overlay) } 'Overlay did not close.'
            Assert (-not $app.HasExited) 'Closing overlay must not exit the app.'
            Assert ([DeskBrawl.WindowTest]::IsWindowVisible($main)) 'Main must remain visible.'
        }

        if ($scenario -eq 'tray') {
            [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
            Wait-Until {
                $replacement = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
                $replacement -ne [IntPtr]::Zero -and [DeskBrawl.WindowTest]::IsWindowVisible($replacement)
            } 'Tray must recreate a closed overlay.'
            $replacement = [DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay')
            Assert (([DeskBrawl.WindowTest]::GetWindowLong($replacement, -20) -band 0x08080020) -eq 0x08080020) 'Recreated overlay must retain input safety flags.'
            for ($cycle = 0; $cycle -lt 3; $cycle++) {
                $foreground = [DeskBrawl.WindowTest]::GetForegroundWindow()
                [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 숨김'])
                Wait-Until { -not [DeskBrawl.WindowTest]::IsWindowVisible($replacement) } 'Repeated hide failed.'
                [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 표시'])
                Wait-Until { [DeskBrawl.WindowTest]::IsWindowVisible($replacement) } 'Repeated show failed.'
                Assert ([DeskBrawl.WindowTest]::GetForegroundWindow() -eq $foreground) 'Repeated show/hide must preserve foreground focus.'
            }
            [DeskBrawl.WindowTest]::Command($tray, $commands['종료'])
        }
        elseif (-not $closeOverlayFirst) {
            [DeskBrawl.WindowTest]::Command($tray, $commands['오버레이 숨김'])
            Wait-Until { -not [DeskBrawl.WindowTest]::IsWindowVisible($overlay) } 'Overlay must be hidden before main closes.'
        }
        if ($scenario -ne 'tray') {
            [DeskBrawl.WindowTest]::Close($main)
        }
        Assert ($app.WaitForExit(10000)) 'Window close or tray exit must terminate the app.'
        Assert ($app.ExitCode -eq 0) "The app exited with code $($app.ExitCode)."
        Assert (-not [DeskBrawl.WindowTest]::IsWindow($main)) 'Exit must destroy the home window.'
        Assert ([DeskBrawl.WindowTest]::Find($app.Id, 'DeskBrawl Overlay') -eq [IntPtr]::Zero) 'Exit must remove the character overlay.'
        Assert ([DeskBrawl.WindowTest]::FindClass($app.Id, 'tray_icon_app') -eq [IntPtr]::Zero) 'Exit must remove the tray window.'
        Write-Output "PASS: native input flags, tray control, focus safety and shutdown ($scenario)"
    }
    finally {
        if (-not $app.HasExited) {
            $app.Kill()
            $app.WaitForExit()
        }
        $app.Dispose()
    }
}
