namespace GeminiLive;

/// <summary>
/// Where the pill's window process lives: the Node we ship and the bundle it runs. The only place
/// either path is built. Node is never looked up on PATH: we do not rely on the machine's.
/// </summary>
public static class PillSidecar {
  /// <summary>The env var that tells the window which process to end with.</summary>
  public const string HostPidVariable = "HOST_PID";

  /// <summary>
  /// "1" when the app has a package identity, which the window inherits: its package's framework
  /// dependency then provides the Windows App SDK, and the bootstrapper refuses to run
  /// (pill/src/main.ts).
  /// </summary>
  public const string PackagedVariable = "PILL_IS_PACKAGED";

  private const string _folder = "pill";
  private const string _nodeFile = "node.exe";
  private const string _entryFile = "main.js";

  public sealed record Launch(string NodeExe, string Entry);

  /// <summary>Both files, or a <see cref="FileNotFoundException"/> that says what is missing.</summary>
  public static Launch Resolve() {
    string folder = Path.Combine(AppContext.BaseDirectory, _folder);
    return new Launch(Require(Path.Combine(folder, _nodeFile)), Require(Path.Combine(folder, _entryFile)));
  }

  private static string Require(string path) {
    return File.Exists(path) ? path : throw new FileNotFoundException($"The pill's window needs {path}", path);
  }
}
