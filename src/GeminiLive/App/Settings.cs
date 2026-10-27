using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>
/// User settings in %LOCALAPPDATA%\GeminiLive\settings.json. The API key is sealed with
/// <see cref="UserSecret"/>.
/// </summary>
public sealed class Settings {
  private static readonly string _filePath = Path.Combine(Log.Dir, "settings.json");
  private static readonly JsonSerializerOptions _json = new() {
    WriteIndented = true,
    Converters = { new JsonStringEnumConverter() },
  };

  public EngineKind Engine { get; set; } = EngineKind.Google;
  public string Model { get; set; } = "gemini-3.8-live";
  public string Voice { get; set; } = "Kore";
  public string? ProtectedApiKey { get; set; }
  /// <summary>
  /// The Gemini page's id for the picked microphone; null follows Windows' default.
  /// </summary>
  public string? MicrophoneId { get; set; }
  /// <summary>Whether the app looks for a newer release on its own; off, it never connects to GitHub.</summary>
  public bool CheckForUpdates { get; set; } = true;

  /// <summary>GEMINI_API_KEY wins, so a key can be rotated without touching the app.</summary>
  [JsonIgnore]
  public string ApiKey {
    get {
      if (Environment.GetEnvironmentVariable("GEMINI_API_KEY") is { Length: > 0 } env) {
        return env;
      }

      if (ProtectedApiKey is not { Length: > 0 } sealedKey) {
        return "";
      }

      return Encoding.UTF8.GetString(UserSecret.Unseal(Convert.FromBase64String(sealedKey)));
    }
  }

  [JsonIgnore]
  public bool HasApiKey => ApiKey.Length > 0;

  public static Settings Load() {
    if (!File.Exists(_filePath)) {
      return new();
    }

    try {
      return JsonSerializer.Deserialize<Settings>(File.ReadAllText(_filePath), _json) ?? new();
    } catch (Exception e) {
      Log.Write($"settings unreadable, using defaults: {e.Message}");
      return new();
    }
  }

  public void SetApiKey(string key) {
    byte[] plain = Encoding.UTF8.GetBytes(key.Trim());
    ProtectedApiKey = Convert.ToBase64String(UserSecret.Seal(plain));
    Save();
  }

  public void Save() {
    Directory.CreateDirectory(Log.Dir);
    File.WriteAllText(_filePath, JsonSerializer.Serialize(this, _json));
  }
}
