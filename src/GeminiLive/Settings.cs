using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GeminiLive;

/// <summary>User settings in %LOCALAPPDATA%\GeminiLive\settings.json. The API key is DPAPI-encrypted.</summary>
public sealed class Settings
{
    public EngineKind Engine { get; set; } = EngineKind.Google;
    public string Model { get; set; } = "gemini-3.8-live";
    public string Voice { get; set; } = "Kore";
    public string? ProtectedApiKey { get; set; }

    static readonly string FilePath = Path.Combine(Log.Dir, "settings.json");
    static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    /// <summary>GEMINI_API_KEY wins, so a key can be rotated without touching the app.</summary>
    public string ApiKey =>
        Environment.GetEnvironmentVariable("GEMINI_API_KEY") is { Length: > 0 } env ? env
        : ProtectedApiKey is { Length: > 0 } p
            ? Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(p), null, DataProtectionScope.CurrentUser))
            : "";

    public bool HasApiKey => ApiKey.Length > 0;

    public void SetApiKey(string key)
    {
        ProtectedApiKey = Convert.ToBase64String(
            ProtectedData.Protect(Encoding.UTF8.GetBytes(key.Trim()), null, DataProtectionScope.CurrentUser));
        Save();
    }

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), Json) ?? new();
        }
        catch (Exception e) { Log.Write($"settings unreadable, using defaults: {e.Message}"); }
        return new();
    }

    public void Save()
    {
        Directory.CreateDirectory(Log.Dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Json));
    }
}
