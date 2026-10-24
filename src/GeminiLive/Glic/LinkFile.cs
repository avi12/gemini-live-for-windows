using System.Text.Json;

namespace GeminiLive.Glic;

/// <summary>
/// Where this run of the app publishes its session link for GeminiLiveHost to hand the extension.
/// Both live in the same package, so they see the same (virtualized) <see cref="Log.Dir"/>.
/// Compiled into both, so the file's place and shape have one home.
/// </summary>
public static class LinkFile {
  private static readonly string _path = Path.Combine(Log.Dir, "link.json");
  private static readonly JsonSerializerOptions _json = WireName.Json;

  /// <summary>Replaces the file whole, so the host never reads half of it.</summary>
  public static void Write(LinkInfo link) {
    Directory.CreateDirectory(Log.Dir);
    string temporary = _path + ".tmp";
    File.WriteAllText(temporary, JsonSerializer.Serialize(link, _json));
    File.Move(temporary, _path, overwrite: true);
  }

  /// <summary>The running app's link; null when it isn't running or left no readable file.</summary>
  public static LinkInfo? Read() {
    if (!AppInstance.IsRunning()) {
      return null;
    }

    try {
      LinkInfo? link = JsonSerializer.Deserialize<LinkInfo>(File.ReadAllText(_path), _json);
      return link is { Port: > 0, Token.Length: > 0 } ? link : null;
    } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) {
      return null;
    }
  }
}
