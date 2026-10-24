using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace GeminiLive.Glic;

/// <summary>One cookie as chrome.cookies reports it (expiration in Unix seconds).</summary>
public sealed record GoogleCookie(string Name, string Value, string Domain, string Path,
                                  bool Secure, bool HttpOnly, string? SameSite,
                                  double? ExpirationDate);

/// <summary>
/// The browser's Google session as our WebView2 needs it: which cookies matter, how they go into
/// the WebView2 jar, and a sealed copy (<see cref="UserSecret"/>) so a restart is signed in before
/// the extension reconnects.
/// </summary>
public static class GoogleCookies {
  private static readonly string _store = Path.Combine(Log.Dir, "google-session.bin");
  private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

  /// <summary>The Google login/session cookies among everything the browser sent.</summary>
  public static List<GoogleCookie> AuthCookies(IEnumerable<GoogleCookie> cookies) {
    return cookies.Where(cookie => IsAuthCookie(cookie.Name)).ToList();
  }

  /// <summary>True when the jar has a Google login at all.</summary>
  public static bool HasSession(IReadOnlyList<GoogleCookie> cookies) {
    return cookies.Any(cookie => cookie.Name is "SID" or "__Secure-1PSID");
  }

  public static void Inject(CoreWebView2CookieManager jar, IReadOnlyList<GoogleCookie> cookies) {
    foreach (GoogleCookie saved in cookies) {
      CoreWebView2Cookie cookie = jar.CreateCookie(saved.Name, saved.Value, saved.Domain, saved.Path);
      cookie.IsSecure = saved.Secure;
      cookie.IsHttpOnly = saved.HttpOnly;
      cookie.SameSite = saved.SameSite switch {
        "strict" => CoreWebView2CookieSameSiteKind.Strict,
        "lax" => CoreWebView2CookieSameSiteKind.Lax,
        _ => CoreWebView2CookieSameSiteKind.None,
      };

      if (saved.ExpirationDate is { } seconds) {
        cookie.Expires =
            DateTimeOffset.FromUnixTimeMilliseconds((long)(seconds * 1000)).UtcDateTime;
      }

      try {
        jar.AddOrUpdateCookie(cookie);
      } catch (Exception e) {
        Log.Write($"cookie {saved.Name}@{saved.Domain} rejected: {e.Message}");
      }
    }
  }

  public static void Save(IReadOnlyList<GoogleCookie> cookies) {
    byte[] plain = JsonSerializer.SerializeToUtf8Bytes(cookies, _json);
    Directory.CreateDirectory(Log.Dir);
    File.WriteAllBytes(_store, UserSecret.Seal(plain));
  }

  public static IReadOnlyList<GoogleCookie> Load() {
    if (!File.Exists(_store)) {
      return [];
    }

    try {
      byte[] plain = UserSecret.Unseal(File.ReadAllBytes(_store));
      return JsonSerializer.Deserialize<List<GoogleCookie>>(plain, _json) ?? [];
    } catch (Exception e) {
      Log.Write($"saved Google session unreadable: {e.Message}");
      return [];
    }
  }

  /// <summary>Stable fingerprint, to skip re-injecting an unchanged session.</summary>
  public static string Fingerprint(IReadOnlyList<GoogleCookie> cookies) {
    IEnumerable<string> lines = cookies
        .OrderBy(cookie => cookie.Domain)
        .ThenBy(cookie => cookie.Name)
        .Select(cookie => $"{cookie.Domain}|{cookie.Name}|{cookie.Value}");
    return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', lines))));
  }

  // The Google login/session family; the rest of a jar is analytics noise.
  private static bool IsAuthCookie(string name) {
    return name.StartsWith("__Secure-", StringComparison.Ordinal)
        || name.StartsWith("__Host-", StringComparison.Ordinal)
        || name is "SID" or "HSID" or "SSID" or "APISID" or "SAPISID" or "LSID" or "OSID"
                or "NID" or "SIDCC" or "ACCOUNT_CHOOSER" or "LSOLH" or "GAPS";
  }
}
