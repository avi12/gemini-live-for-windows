using Microsoft.Win32;

namespace GeminiLive.Glic;

/// <summary>
/// One-click setup for the companion extension: put its files somewhere a browser can load them
/// from, copy that path, and open the default browser's extensions page. Loading an unpacked
/// extension is the one step a browser won't let an app do for you.
/// </summary>
public static class ExtensionSetup {
  private const string _httpsChoiceKey = @"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell"
                                         + @"\Associations\UrlAssociations\https\UserChoice";

  // Not under AppData, so an MSIX install doesn't virtualize it away from the browser.
  private static readonly string _folder =
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                   ".gemini-live", "extension");

  private static readonly string _shipped = Path.Combine(AppContext.BaseDirectory, "extension");

  public static void Begin() {
    CopyShippedFiles();
    try {
      System.Windows.Clipboard.SetText(_folder);
    } catch {
      // Clipboard busy; the steps in the caption still say where to look.
    }

    (string exe, string page) = DefaultBrowser();
    try {
      Shell.Open(exe, page);
    } catch (Exception e) {
      Log.Write($"could not open {page}: {e.Message}");
    }
  }

  /// <summary>
  /// Keeps an installed copy current with the build this app ships, so an update reaches the
  /// browser the next time it reloads the extension. Does nothing before the first setup.
  /// </summary>
  public static void RefreshInstalled() {
    if (!Directory.Exists(_folder)) {
      return;
    }
    try {
      CopyShippedFiles();
    } catch (Exception e) {
      Log.Write($"extension refresh failed: {e.Message}");
    }
  }

  private static void CopyShippedFiles() {
    foreach (string source in
             Directory.EnumerateFiles(_shipped, "*", SearchOption.AllDirectories)) {
      string target = Path.Combine(_folder, Path.GetRelativePath(_shipped, source));
      Directory.CreateDirectory(Path.GetDirectoryName(target)!);
      File.Copy(source, target, overwrite: true);
    }
  }

  /// <summary>
  /// The browser the user actually browses in, since that's whose Google session we want.
  /// </summary>
  private static (string Exe, string Page) DefaultBrowser() {
    string progId = Registry.GetValue(_httpsChoiceKey, "ProgId", null) as string ?? "";
    if (progId.StartsWith("Chrome", StringComparison.OrdinalIgnoreCase)) {
      return ("chrome", "chrome://extensions");
    }
    if (progId.StartsWith("Brave", StringComparison.OrdinalIgnoreCase)) {
      return ("brave", "brave://extensions");
    }
    return ("msedge", "edge://extensions");
  }
}
