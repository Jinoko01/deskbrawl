param(
    [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\src-tauri\target\release\deskbrawl.exe')
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

namespace DeskBrawl {
    public static class WindowTest {
        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }
        private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr window);
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

        public static IntPtr Find(int processId, string title) {
            IntPtr result = IntPtr.Zero;
            EnumWindows((window, parameter) => {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner != processId) return true;
                var text = new StringBuilder(256);
                GetWindowText(window, text, text.Capacity);
                if (text.ToString() != title) return true;
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

foreach ($closeOverlayFirst in @($false, $true)) {
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
        Assert (-not [DeskBrawl.WindowTest]::IsWindowVisible($overlay)) 'Overlay must start hidden.'
        $style = [DeskBrawl.WindowTest]::GetWindowLong($overlay, -16)
        $extendedStyle = [DeskBrawl.WindowTest]::GetWindowLong($overlay, -20)
        Assert (-not [DeskBrawl.WindowTest]::HasNoFrame($main)) 'Main must retain its normal frame.'
        Assert ([DeskBrawl.WindowTest]::HasNoFrame($overlay)) 'Overlay must have no frame outside its client area.'
        Assert (-not [DeskBrawl.WindowTest]::IsWindowVisible($overlay)) 'Frame recalculation must leave overlay hidden.'
        Assert (($style -band 0x00040000) -eq 0) 'Overlay must not be resizable.'
        Assert (($extendedStyle -band 0x00000008) -ne 0) 'Overlay must be topmost.'
        Assert (($extendedStyle -band 0x08000000) -ne 0) 'Overlay must not activate.'

        if ($closeOverlayFirst) {
            [DeskBrawl.WindowTest]::Close($overlay)
            Wait-Until { -not [DeskBrawl.WindowTest]::IsWindow($overlay) } 'Overlay did not close.'
            Assert (-not $app.HasExited) 'Closing overlay must not exit the app.'
            Assert ([DeskBrawl.WindowTest]::IsWindowVisible($main)) 'Main must remain visible.'
        }

        [DeskBrawl.WindowTest]::Close($main)
        Assert ($app.WaitForExit(10000)) 'Closing main must exit the app, including hidden overlay.'
        Assert ($app.ExitCode -eq 0) "The app exited with code $($app.ExitCode)."
        Write-Output "PASS: window configuration and shutdown (overlay closed first: $closeOverlayFirst)"
    }
    finally {
        if (-not $app.HasExited) {
            $app.Kill()
            $app.WaitForExit()
        }
        $app.Dispose()
    }
}
