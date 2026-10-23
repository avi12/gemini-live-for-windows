namespace GeminiLive;

/// <summary>
/// For enums whose names double as wire values (shared with JS or a web API): the wire value is
/// the camelCased name ("query", "booted", "submitAndRead", …), so the enum stays the one source
/// of truth.
/// </summary>
internal static class WireName {
  public static string Of<T>(T value) where T : struct, Enum {
    string name = value.ToString();
    return char.ToLowerInvariant(name[0]) + name[1..];
  }

  /// <summary>The value spelled <paramref name="wire"/> on the wire; null for anything else.</summary>
  public static T? Parse<T>(string? wire) where T : struct, Enum {
    foreach (T value in Enum.GetValues<T>()) {
      if (Of(value) == wire) {
        return value;
      }
    }
    return null;
  }
}
