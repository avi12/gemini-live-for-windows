using System.Diagnostics;

namespace GeminiLive;

/// <summary>Hands a URL or a program to Windows, the way double-clicking it would.</summary>
public static class Shell {
  public static void Open(string target, string arguments = "") {
    Process.Start(new ProcessStartInfo(target, arguments) { UseShellExecute = true });
  }
}
