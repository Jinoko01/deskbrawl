// Disposable Windows input receiver. Compile with the Windows .NET Framework compiler.
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

class M0InputProbe : Form {
    private int left, right, drag, wheel, keys;
    private readonly Label counts = new Label();
    private readonly TextBox editor = new TextBox();
    private readonly string output;

    M0InputProbe(string outputPath) {
        output = outputPath;
        Text = "DeskBrawl M0 Native Input Probe";
        WindowState = FormWindowState.Maximized;
        KeyPreview = true;
        counts.Dock = DockStyle.Top;
        counts.Height = 48;
        counts.Font = new Font("Segoe UI", 16);
        editor.Dock = DockStyle.Fill;
        editor.Multiline = true;
        editor.ScrollBars = ScrollBars.Vertical;
        editor.Font = new Font("Consolas", 18);
        for (int i = 1; i <= 160; i++) editor.AppendText("Controlled M0 line " + i + Environment.NewLine);
        editor.SelectionStart = 0;
        editor.ScrollToCaret();
        Controls.Add(editor);
        Controls.Add(counts);
        editor.MouseDown += delegate(object sender, MouseEventArgs e) {
            if (e.Button == MouseButtons.Left) left++;
            if (e.Button == MouseButtons.Right) right++;
            Report();
        };
        editor.MouseMove += delegate(object sender, MouseEventArgs e) {
            if (e.Button == MouseButtons.Left) { drag++; Report(); }
        };
        editor.MouseWheel += delegate { wheel++; Report(); };
        KeyDown += delegate { keys++; Report(); };
        FormClosed += delegate {
            File.WriteAllText(output, String.Format("{{\"left\":{0},\"right\":{1},\"drag\":{2},\"wheel\":{3},\"keys\":{4},\"probeText\":{5}}}",
                left, right, drag, wheel, keys, editor.Text.Contains("M0 input confirmed") ? "true" : "false"));
        };
        Report();
    }

    void Report() { counts.Text = String.Format("left={0}  right={1}  drag={2}  wheel={3}  keys={4}", left, right, drag, wheel, keys); }

    [STAThread]
    static void Main(string[] args) {
        if (args.Length != 1) throw new ArgumentException("Expected one test output path");
        Application.EnableVisualStyles();
        Application.Run(new M0InputProbe(args[0]));
    }
}
