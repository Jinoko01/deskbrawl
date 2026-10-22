// Test-owned foreground window for background PLAY input. Built with Windows .NET Framework.
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class BackgroundInputProbe : Form {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint current, uint target, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    [STAThread]
    static void Main() { Application.Run(new BackgroundInputProbe()); }

    BackgroundInputProbe() {
        Text = "DeskBrawl background input test";
        Width = 480;
        Height = 180;
        Controls.Add(new Label { Text = "Test-owned work window. Game input must preserve this window's focus.", Dock = DockStyle.Fill });
        KeyPreview = true;
        KeyDown += delegate(object sender, KeyEventArgs e) { Console.WriteLine("KEY:" + e.KeyValue); };
        Shown += delegate {
            FocusOwnedWindow();
            Console.WriteLine(GetForegroundWindow() == Handle ? "READY" : "ERROR:could not focus owned probe");
            Console.WriteLine("HANDLE:" + Handle.ToInt64());
            var reader = new Thread(delegate() {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    var command = line;
                    BeginInvoke(new Action(delegate { Apply(command); }));
                }
            });
            reader.IsBackground = true;
            reader.Start();
        };
    }

    void FocusOwnedWindow() {
        var current = GetCurrentThreadId();
        var foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        var attached = current != foreground && AttachThreadInput(current, foreground, true);
        try { SetForegroundWindow(Handle); }
        finally { if (attached) AttachThreadInput(current, foreground, false); }
    }

    void Apply(string command) {
        if (command == "exit") { Close(); return; }
        if (command == "slash") {
            FocusOwnedWindow();
            if (GetForegroundWindow() != Handle) { Console.WriteLine("ERROR:probe lost foreground"); return; }
            keybd_event(191, 53, 0, UIntPtr.Zero);
            keybd_event(191, 53, 2, UIntPtr.Zero);
            return;
        }
        if (GetForegroundWindow() != Handle) { Console.WriteLine("ERROR:probe lost foreground"); return; }
        if (command == "toggle") {
            foreach (byte key in new byte[] { 0x11, 0x10, 0x47 }) keybd_event(key, 0, 0, UIntPtr.Zero);
            foreach (byte key in new byte[] { 0x47, 0x10, 0x11 }) keybd_event(key, 0, 2, UIntPtr.Zero);
            return;
        }
        var parts = command.Split(' ');
        if (parts.Length != 4 || (parts[0] != "down" && parts[0] != "up")) { Console.WriteLine("ERROR:invalid test command"); return; }
        byte virtualKey, scan;
        uint extended;
        if (!Byte.TryParse(parts[1], out virtualKey) || !Byte.TryParse(parts[2], out scan)
            || !UInt32.TryParse(parts[3], out extended) || extended > 1) { Console.WriteLine("ERROR:invalid test key"); return; }
        keybd_event(virtualKey, scan, extended | (parts[0] == "up" ? 2u : 0u), UIntPtr.Zero);
    }
}
