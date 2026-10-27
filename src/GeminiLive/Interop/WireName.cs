using System.Text.Json;
using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>
/// For enums whose names double as wire values (shared with JS or a web API): the wire value is
/// the camelCased name ("query", "booted", "submitAndRead", …), so the enum stays the one source
/// of truth.
/// </summary>
internal static class WireName {
  /// <summary>
  /// The JSON we exchange with JS and keep on disk: camelCase property names, and enums spelled as
  /// <see cref="For{T}"/> spells them.
  /// </summary>
  public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) {
    Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
  };

  public static string For<T>(T value) where T : struct, Enum {
    return JsonNamingPolicy.CamelCase.ConvertName(value.ToString());
  }

  /// <summary>The value spelled <paramref name="wire"/> on the wire; null for anything else.</summary>
  public static T? Parse<T>(string? wire) where T : struct, Enum {
    foreach (T value in Enum.GetValues<T>()) {
      if (For(value) == wire) {
        return value;
      }
    }
    return null;
  }
}
