using System.Diagnostics;
using System.Text.Json;

namespace GeminiLive;

/// <summary>
/// The file <c>pnpm dev</c> keeps in <see cref="Log.Dir"/> while it runs: where the pill's code is
/// served from the repo instead of the bundle. Mirrors protocol/src/pill-dev.ts one for one.
/// </summary>
public sealed record PillDevMarker(string PillDevEntry, string RepoRoot, int Pid) {
  public const string FileName = "dev.json";

  public static string Path { get; } = System.IO.Path.Combine(Log.Dir, FileName);

  /// <summary>The marker only when it is well formed, its process is alive and its entry exists.</summary>
  public static PillDevMarker? Read() {
    PillDevMarker? marker = Parse();
    return marker is not null && IsUsable(marker) ? marker : null;
  }

  private static PillDevMarker? Parse() {
    try {
      using JsonDocument document = JsonDocument.Parse(File.ReadAllText(Path));
      JsonElement root = document.RootElement;
      string? entry = ReadString(root, "pillDevEntry");
      string? repoRoot = ReadString(root, "repoRoot");
      bool isPid = root.TryGetProperty("pid", out JsonElement pidValue) && pidValue.TryGetInt32(out int pid) && pid > 0;
      return entry is null || repoRoot is null || !isPid
          ? null
          : new PillDevMarker(entry, repoRoot, pidValue.GetInt32());
    } catch (Exception e) when (e is IOException or JsonException or InvalidOperationException) {
      return null;
    }
  }

  private static string? ReadString(JsonElement root, string name) {
    bool isString = root.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String;
    return isString && !string.IsNullOrEmpty(value.GetString()) ? value.GetString() : null;
  }

  private static bool IsUsable(PillDevMarker marker) {
    return File.Exists(marker.PillDevEntry) && Directory.Exists(marker.RepoRoot) && IsRunning(marker.Pid);
  }

  private static bool IsRunning(int pid) {
    try {
      using Process process = Process.GetProcessById(pid);
      return !process.HasExited;
    } catch (ArgumentException) {
      return false;
    }
  }
}
