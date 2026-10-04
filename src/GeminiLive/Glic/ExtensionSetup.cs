using System.Diagnostics;
using Microsoft.Win32;

namespace GeminiLive.Glic;

/// <summary>
/// One-click setup for the companion extension: put its files somewhere a browser can load them
/// from, copy that path, and open the default browser's extensions page. Loading an unpacked
/// extension is the one step a browser won't let an app do for you.
/// </summary>
public static class ExtensionSetup
{
    /// <summary>Not under AppData, so an MSIX install doesn't virtualize it away from the browser.</summary>
    public static readonly string Folder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini-live", "extension");

    static readonly string Shipped = Path.Combine(AppContext.BaseDirectory, "extension");

    public static void Begin()
    {
        CopyShippedFiles();
        try { System.Windows.Clipboard.SetText(Folder); } catch { /* clipboard busy; the path is in the caption too */ }

        var (exe, page) = DefaultBrowser();
        try { Process.Start(new ProcessStartInfo(exe, page) { UseShellExecute = true }); }
        catch (Exception e) { Log.Write($"could not open {page}: {e.Message}"); }
    }

    static void CopyShippedFiles()
    {
        foreach (var source in Directory.EnumerateFiles(Shipped, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(Folder, Path.GetRelativePath(Shipped, source));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target, overwrite: true);
        }
    }

    /// <summary>The browser the user actually browses in, since that's whose Google session we want.</summary>
    static (string Exe, string Page) DefaultBrowser()
    {
        var progId = Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
            "ProgId", null) as string ?? "";
        return progId.StartsWith("Chrome", StringComparison.OrdinalIgnoreCase)
            ? ("chrome", "chrome://extensions")
            : progId.StartsWith("Brave", StringComparison.OrdinalIgnoreCase)
                ? ("brave", "brave://extensions")
                : ("msedge", "edge://extensions");
    }
}
