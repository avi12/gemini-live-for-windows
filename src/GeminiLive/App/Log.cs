namespace GeminiLive;

/// <summary>Append-only diagnostics log in %LOCALAPPDATA%\GeminiLive\log.txt.</summary>
public static class Log {
  /// <summary>Where all our per-user files live, the log included.</summary>
  public static readonly string Dir = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GeminiLive");

  /// <summary>
  /// GEMINI_LIVE_DEBUG=1, or a debug.flag file in <see cref="Dir"/> (for launches that can't carry
  /// env vars): devtools + CDP on a free port the log names, and our overlays stay visible to screenshots.
  /// </summary>
  public static readonly bool Debugging =
      Environment.GetEnvironmentVariable("GEMINI_LIVE_DEBUG") is not null
      || File.Exists(Path.Combine(Dir, "debug.flag"));

  private static readonly string _file = Path.Combine(Dir, "log.txt");
  private static readonly object _gate = new();

  public static void Write(string message) {
    try {
      lock (_gate) {
        Directory.CreateDirectory(Dir);
        File.AppendAllText(_file, $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
      }
    } catch {
      // Logging must never take the app down.
    }
  }

  /// <summary>Runs <paramref name="work"/>; null, logged as "<paramref name="what"/> failed", if it throws.</summary>
  public static T? Attempt<T>(string what, Func<T?> work) where T : class {
    try {
      return work();
    } catch (Exception e) {
      Write($"{what} failed: {e.Message}");
      return null;
    }
  }

  /// <summary>The async <see cref="Attempt{T}"/>.</summary>
  public static async Task<T?> AttemptAsync<T>(string what, Func<Task<T>> work) where T : class {
    try {
      return await work();
    } catch (Exception e) {
      Write($"{what} failed: {e.Message}");
      return null;
    }
  }
}
