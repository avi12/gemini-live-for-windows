namespace GeminiLive.Glic;

/// <summary>
/// Every message between <see cref="GlicHost"/> and the glic page's bridge, both directions
/// (GlicMessage in bridge/glic_protocol.ts; wire value: <see cref="WireName"/>).
/// </summary>
public enum GlicMessage {
  // app → page
  Start,
  Stop,
  SetMuted,
  ListMics,
  SetMic,
  BeginAction,
  SubmitAndRead,
  // page → app
  Booted,
  Ready,
  State,
  Transcript,
  Error,
  Capture,
  Read,
}

/// <summary>The Live states the page reports.</summary>
public enum GlicState { Idle, Listening, Resuming }

/// <summary>Who spoke a transcript line.</summary>
public enum TranscriptDirection { User, Assistant }

/// <summary>A microphone the page can open.</summary>
public sealed record Microphone(string Id, string Label);

/// <summary>One utterance so far; a later line with the same index revises it.</summary>
public sealed record TranscriptLine(string Text, TranscriptDirection Direction, int Index);

/// <summary>A picture for Gemini; Data travels as base64.</summary>
public sealed record Picture(byte[] Data, string MimeType, int Width, int Height);

/// <summary>A link in a text answer: a search result, a cited source, a page Gemini points at.</summary>
public sealed record AnswerLink(string Title, string Url);

/// <summary>A text turn's answer, with the links its page showed (Live can only say them).</summary>
public sealed record TextAnswer(string Text, IReadOnlyList<AnswerLink> Links);

/// <summary>
/// The glic protocol map: each message with its data and return types, as GlicProtocolMap in
/// bridge/glic_protocol.ts declares them.
/// </summary>
public static class GlicProtocol {
  public static readonly Protocol<GlicMessage, None, None> Start = new(GlicMessage.Start);
  public static readonly Protocol<GlicMessage, None, None> Stop = new(GlicMessage.Stop);
  public static readonly Protocol<GlicMessage, bool, None> SetMuted = new(GlicMessage.SetMuted);
  public static readonly Protocol<GlicMessage, None, IReadOnlyList<Microphone>> ListMics =
      new(GlicMessage.ListMics);
  public static readonly Protocol<GlicMessage, string?, None> SetMic = new(GlicMessage.SetMic);
  /// <summary>Switches to text mode; whether a focused, empty text box is ready for typing.</summary>
  public static readonly Protocol<GlicMessage, None, bool> BeginAction =
      new(GlicMessage.BeginAction);
  /// <summary>Submits the typed request; the answer and its links.</summary>
  public static readonly Protocol<GlicMessage, None, TextAnswer> SubmitAndRead =
      new(GlicMessage.SubmitAndRead);

  public static readonly Protocol<GlicMessage, None, None> Booted = new(GlicMessage.Booted);
  public static readonly Protocol<GlicMessage, None, None> Ready = new(GlicMessage.Ready);
  public static readonly Protocol<GlicMessage, GlicState, None> State = new(GlicMessage.State);
  public static readonly Protocol<GlicMessage, TranscriptLine, None> Transcript =
      new(GlicMessage.Transcript);
  /// <summary>A failure: one of the page's error codes, or a message to show.</summary>
  public static readonly Protocol<GlicMessage, string, None> Error = new(GlicMessage.Error);
  /// <summary>A picture of the shared screen or camera; null when there is none.</summary>
  public static readonly Protocol<GlicMessage, None, Picture?> Capture = new(GlicMessage.Capture);
  /// <summary>An exact text copy of the window on the shared display; null when there is none.</summary>
  public static readonly Protocol<GlicMessage, None, ScreenText.View?> Read = new(GlicMessage.Read);
}
