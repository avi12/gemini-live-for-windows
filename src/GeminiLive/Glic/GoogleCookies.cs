using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace GeminiLive.Glic;

/// <summary>
/// First-run sign-in shortcut: if Agentic Gaming Assistant's browser extension has already synced
/// your Google session, copy its login cookies into our WebView2 profile so Gemini opens signed in.
/// After that the WebView2 profile keeps its own session fresh, exactly like a browser does.
/// </summary>
public static class GoogleCookies
{
    static readonly string Bundle = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "com.avi.agentic-gaming-assistant", "credentials", "gemini.json");

    // The Google login/session family; the rest of a jar is analytics noise.
    static bool IsAuthCookie(string name) =>
        name.StartsWith("__Secure-") || name.StartsWith("__Host-") ||
        name is "SID" or "HSID" or "SSID" or "APISID" or "SAPISID" or "LSID" or "OSID" or "NID"
             or "SIDCC" or "ACCOUNT_CHOOSER" or "LSOLH" or "GAPS";

    public static async Task<bool> IsSignedInAsync(CoreWebView2CookieManager jar)
    {
        var cookies = await jar.GetCookiesAsync("https://gemini.google.com");
        return cookies.Any(c => c.Name is "SID" or "__Secure-1PSID");
    }

    /// <returns>How many cookies were imported (0 when there is no bundle).</returns>
    public static int ImportFromAgenticGamingAssistant(CoreWebView2CookieManager jar)
    {
        if (!File.Exists(Bundle)) return 0;
        using var doc = JsonDocument.Parse(File.ReadAllText(Bundle));
        int count = 0;
        foreach (var c in doc.RootElement.GetProperty("cookies").EnumerateArray())
        {
            var name = c.GetProperty("name").GetString()!;
            if (!IsAuthCookie(name)) continue;
            var domain = c.GetProperty("domain").GetString()!;
            var path = c.TryGetProperty("path", out var p) ? p.GetString() ?? "/" : "/";
            var cookie = jar.CreateCookie(name, c.GetProperty("value").GetString()!, domain, path);
            cookie.IsSecure = c.TryGetProperty("secure", out var s) && s.GetBoolean();
            cookie.IsHttpOnly = c.TryGetProperty("httpOnly", out var h) && h.GetBoolean();
            cookie.SameSite = (c.TryGetProperty("sameSite", out var ss) ? ss.GetString() : null) switch
            {
                "strict" => CoreWebView2CookieSameSiteKind.Strict,
                "lax" => CoreWebView2CookieSameSiteKind.Lax,
                _ => CoreWebView2CookieSameSiteKind.None,
            };
            if (c.TryGetProperty("expirationDate", out var e) && e.ValueKind == JsonValueKind.Number)
                cookie.Expires = DateTimeOffset.FromUnixTimeMilliseconds((long)(e.GetDouble() * 1000)).UtcDateTime;
            try { jar.AddOrUpdateCookie(cookie); count++; }
            catch (Exception ex) { Log.Write($"cookie {name}@{domain} rejected: {ex.Message}"); }
        }
        Log.Write($"imported {count} Google cookies from Agentic Gaming Assistant");
        return count;
    }
}
