using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>How the glow under the pill behaves (GlowMode in pill/src/protocol/view.ts).</summary>
public enum GlowMode {
  Rest,
  Breathe,
  Level,
}

/// <summary>
/// Every action the pill window sends back (PillActionKind in pill/src/protocol/view.ts; wire value:
/// <see cref="WireName"/>).
/// </summary>
public enum PillActionKind {
  Mute,
  End,
  Share,
  SetMicrophone,
  RefreshMicrophones,
  SetCamera,
  SetEngine,
  AskForKey,
  SubmitKey,
  CancelKey,
  ConnectExtension,
  OpenLink,
  Update,
  CheckForUpdates,
  SetAutoUpdate,
  Quit,
  SetFocusable,
  MoveBy,
}

/// <summary>The engine's own names are its wire values, not camelCased ones.</summary>
internal sealed class EngineWire : JsonStringEnumConverter<EngineKind>;

/// <summary>One line of the caption card. A note is ours (why a session ended), not Gemini's words.</summary>
public sealed record PillLine(string Id, string Text, bool IsUser, bool IsNote);

/// <summary>A link chip: Address is its readable form for the tooltip, IsSearch marks a search we built.</summary>
public sealed record PillLink(string Id, string Title, string Uri, string Address, bool IsSearch);

/// <summary>A display or a microphone: what to send back, and what to call it.</summary>
public sealed record PillNamed(string Id, string Name);

public sealed record PillDisplayEntry(string Id, string Name, int RefreshRateHertz, int X, int Y, int Width,
                                      int Height);

/// <summary>The update entry of the gear menu; the view carries none when there is nothing to update.</summary>
public sealed record PillUpdate(string Text, bool IsAvailable, bool IsAutoUpdateOn);

public sealed record PillGlow(GlowMode Mode, double Level, bool IsUser);

/// <summary>
/// Everything the pill window draws, as pill/src/protocol/view.ts spells it (pillViewSchema), names and
/// shapes one for one. The C# app owns it and sends the whole value after each change.
/// </summary>
public sealed record PillView(
    string Status,
    string StatusDetail,
    bool IsMuted,
    IReadOnlyList<PillLine> Lines,
    IReadOnlyList<PillLink> Links,
    IReadOnlyList<PillDisplayEntry> Displays,
    string? PillDisplay,
    string? SharedDisplay,
    string? SharedDisplayName,
    bool IsExtensionNeeded,
    bool IsExtensionStepsShown,
    bool IsKeyPromptShown,
    [property: JsonConverter(typeof(EngineWire))] EngineKind Engine,
    IReadOnlyList<PillNamed> Microphones,
    string? MicrophoneId,
    bool IsCameraShared,
    PillUpdate? Update,
    PillGlow Glow,
    bool IsShown,
    bool IsFocusable) {
  /// <summary>The state's name in the snapshot frame (VIEW_NAME).</summary>
  public const string Name = "view";
}

/// <summary>
/// An action from the window, one variant per <see cref="PillActionKind"/>
/// (<see cref="PillActionParser"/> makes them from the wire).
/// </summary>
public abstract record PillAction {
  public sealed record Mute : PillAction;

  /// <summary>The <see cref="PillActionKind.End"/> action.</summary>
  public sealed record Finish : PillAction;

  public sealed record Share(string DisplayId) : PillAction;

  public sealed record SetMicrophone(string? MicrophoneId) : PillAction;

  public sealed record RefreshMicrophones : PillAction;

  public sealed record SetCamera(bool IsOn) : PillAction;

  public sealed record SetEngine(EngineKind Engine) : PillAction;

  public sealed record AskForKey : PillAction;

  public sealed record SubmitKey(string Key) : PillAction;

  public sealed record CancelKey : PillAction;

  public sealed record ConnectExtension : PillAction;

  public sealed record OpenLink(Uri Uri) : PillAction;

  public sealed record Update : PillAction;

  public sealed record CheckForUpdates : PillAction;

  public sealed record SetAutoUpdate(bool IsOn) : PillAction;

  public sealed record Quit : PillAction;

  public sealed record SetFocusable(bool IsFocusable) : PillAction;

  public sealed record MoveBy(double DeltaX, double DeltaY) : PillAction;
}
