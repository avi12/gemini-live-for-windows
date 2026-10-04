namespace GeminiLive;

/// <summary>Append-only diagnostics log in %LOCALAPPDATA%\GeminiLive\log.txt.</summary>
public static class Log
{
    public static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GeminiLive");
    static readonly string File = Path.Combine(Dir, "log.txt");

    /// <summary>
    /// GEMINI_LIVE_DEBUG=1, or a debug.flag file in <see cref="Dir"/> (for launches that can't carry
    /// env vars): devtools + CDP on localhost:9333, and our overlays stay visible to screenshots.
    /// </summary>
    public static readonly bool Debugging = Environment.GetEnvironmentVariable("GEMINI_LIVE_DEBUG") is not null
        || System.IO.File.Exists(Path.Combine(Dir, "debug.flag"));
    static readonly object Gate = new();

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Dir);
                System.IO.File.AppendAllText(File, $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
        }
        catch { /* logging must never take the app down */ }
    }
}
