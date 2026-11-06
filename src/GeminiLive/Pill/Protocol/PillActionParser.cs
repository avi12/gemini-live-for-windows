using System.Text.Json;

namespace GeminiLive;

/// <summary>
/// Turns an action off the wire into a <see cref="PillAction"/>, refusing anything the contract
/// (pillActionSchema) does not allow: the window is validated on its side, and here again.
/// </summary>
public static class PillActionParser {
  private const double _maxMove = 10_000;  // physical px in one message
  private static readonly string[] _openableSchemes = [Uri.UriSchemeHttps, Uri.UriSchemeHttp];

  private static class Field {
    public const string Kind = "kind";
    public const string DisplayId = "displayId";
    public const string MicrophoneId = "microphoneId";
    public const string IsOn = "isOn";
    public const string Engine = "engine";
    public const string Key = "key";
    public const string Uri = "uri";
    public const string IsFocusable = "isFocusable";
    public const string DeltaX = "dx";
    public const string DeltaY = "dy";
  }

  public static PillAction Parse(JsonElement data) {
    if (data.ValueKind != JsonValueKind.Object) {
      throw new FormatException("An action must be an object");
    }

    PillActionKind kind = ReadKind(data);
    return kind switch {
      PillActionKind.Mute => new PillAction.Mute(),
      PillActionKind.End => new PillAction.Finish(),
      PillActionKind.Share => new PillAction.Share(Text(data, Field.DisplayId)),
      PillActionKind.SetMicrophone => new PillAction.SetMicrophone(NullableText(data, Field.MicrophoneId)),
      PillActionKind.RefreshMicrophones => new PillAction.RefreshMicrophones(),
      PillActionKind.SetCamera => new PillAction.SetCamera(Flag(data, Field.IsOn)),
      PillActionKind.SetEngine => new PillAction.SetEngine(Engine(data)),
      PillActionKind.AskForKey => new PillAction.AskForKey(),
      PillActionKind.SubmitKey => new PillAction.SubmitKey(Key(data)),
      PillActionKind.CancelKey => new PillAction.CancelKey(),
      PillActionKind.ConnectExtension => new PillAction.ConnectExtension(),
      PillActionKind.OpenLink => new PillAction.OpenLink(Link(data)),
      PillActionKind.Update => new PillAction.Update(),
      PillActionKind.CheckForUpdates => new PillAction.CheckForUpdates(),
      PillActionKind.SetAutoUpdate => new PillAction.SetAutoUpdate(Flag(data, Field.IsOn)),
      PillActionKind.Quit => new PillAction.Quit(),
      PillActionKind.SetFocusable => new PillAction.SetFocusable(Flag(data, Field.IsFocusable)),
      PillActionKind.MoveBy => new PillAction.MoveBy(Distance(data, Field.DeltaX), Distance(data, Field.DeltaY)),
      _ => throw new FormatException($"Unhandled action kind '{kind}'"),
    };
  }

  private static PillActionKind ReadKind(JsonElement data) {
    string wire = Text(data, Field.Kind);
    return WireName.Parse<PillActionKind>(wire) ?? throw new FormatException($"Unknown action kind '{wire}'");
  }

  private static JsonElement Required(JsonElement data, string name) {
    return data.TryGetProperty(name, out JsonElement value)
        ? value
        : throw new FormatException($"'{name}' is missing");
  }

  private static string Text(JsonElement data, string name) {
    JsonElement value = Required(data, name);
    if (value.ValueKind != JsonValueKind.String) {
      throw new FormatException($"'{name}' must be a string");
    }

    return value.GetString()!;
  }

  private static string? NullableText(JsonElement data, string name) {
    return Required(data, name).ValueKind == JsonValueKind.Null ? null : Text(data, name);
  }

  private static bool Flag(JsonElement data, string name) {
    JsonElement value = Required(data, name);
    return value.ValueKind switch {
      JsonValueKind.True => true,
      JsonValueKind.False => false,
      _ => throw new FormatException($"'{name}' must be true or false"),
    };
  }

  private static double Distance(JsonElement data, string name) {
    JsonElement value = Required(data, name);
    if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out double distance)
        || Math.Abs(distance) > _maxMove) {
      throw new FormatException($"'{name}' must be a number within {_maxMove}");
    }

    return distance;
  }

  private static EngineKind Engine(JsonElement data) {
    string name = Text(data, Field.Engine);
    if (!Enum.IsDefined(typeof(EngineKind), name)) {
      throw new FormatException($"Unknown engine '{name}'");
    }

    return Enum.Parse<EngineKind>(name);
  }

  private static string Key(JsonElement data) {
    string key = Text(data, Field.Key).Trim();
    return key.Length > 0 ? key : throw new FormatException("The key is empty");
  }

  private static Uri Link(JsonElement data) {
    string text = Text(data, Field.Uri);
    if (!Uri.TryCreate(text, UriKind.Absolute, out Uri? uri) || !_openableSchemes.Contains(uri.Scheme)) {
      throw new FormatException("Only http and https links open");
    }

    return uri;
  }
}
