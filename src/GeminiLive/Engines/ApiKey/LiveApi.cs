using System.Text.Json;
using System.Text.Json.Serialization;

namespace GeminiLive;

/// <summary>
/// The public Gemini Live API's wire messages (BidiGenerateContent, https://ai.google.dev/api/live),
/// only the parts <see cref="LiveSession"/> sends or reads. Strict where we depend on a field: a
/// constructor parameter without a default is required and non-nullable, so a message missing it
/// fails to parse. Lenient elsewhere: fields Google adds later land in
/// <see cref="LiveServerMessage.Unhandled"/> instead of failing.
/// </summary>
public static class LiveApi {
  /// <summary>
  /// <see cref="WireName.Json"/>'s camelCase, with nulls left off the wire and required fields and
  /// nullability enforced on the way in.
  /// </summary>
  public static readonly JsonSerializerOptions Json = new(WireName.Json) {
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    RespectNullableAnnotations = true,
    RespectRequiredConstructorParameters = true,
  };

  public static string Serialize(LiveClientMessage message) {
    return JsonSerializer.Serialize(message, Json);
  }

  /// <summary>Throws <see cref="JsonException"/> when a required field is missing or null.</summary>
  public static LiveServerMessage Parse(ReadOnlySpan<byte> json) {
    return JsonSerializer.Deserialize<LiveServerMessage>(json, Json)
        ?? throw new JsonException("Live API sent null");
  }
}

// ---- shared ----

public enum Modality {
  [JsonStringEnumMemberName("AUDIO")] Audio,
  [JsonStringEnumMemberName("TEXT")] Text,
}

public enum MediaResolution {
  [JsonStringEnumMemberName("MEDIA_RESOLUTION_LOW")] Low,
  [JsonStringEnumMemberName("MEDIA_RESOLUTION_MEDIUM")] Medium,
  [JsonStringEnumMemberName("MEDIA_RESOLUTION_HIGH")] High,
}

/// <summary>Inline media; Data travels as base64.</summary>
public sealed record Blob(string MimeType, byte[] Data);

public sealed record Part(string? Text = null, Blob? InlineData = null);

public sealed record Content(IReadOnlyList<Part> Parts);

// ---- client → server: exactly one field per message ----

public sealed record LiveClientMessage(LiveSetup? Setup = null, RealtimeInput? RealtimeInput = null);

public sealed record LiveSetup(
    string Model,
    GenerationConfig GenerationConfig,
    Content SystemInstruction,
    IReadOnlyList<Tool> Tools,
    AudioTranscriptionConfig InputAudioTranscription,
    AudioTranscriptionConfig OutputAudioTranscription,
    ContextWindowCompressionConfig ContextWindowCompression,
    SessionResumptionConfig SessionResumption);

public sealed record GenerationConfig(
    IReadOnlyList<Modality> ResponseModalities, MediaResolution MediaResolution,
    SpeechConfig SpeechConfig);

public sealed record SpeechConfig(VoiceConfig VoiceConfig);

public sealed record VoiceConfig(PrebuiltVoiceConfig PrebuiltVoiceConfig);

public sealed record PrebuiltVoiceConfig(string VoiceName);

public sealed record Tool(GoogleSearch? GoogleSearch = null);

/// <summary>Google Search grounding; an empty object turns it on.</summary>
public sealed record GoogleSearch;

/// <summary>An empty object turns the transcription on.</summary>
public sealed record AudioTranscriptionConfig;

public sealed record ContextWindowCompressionConfig(SlidingWindow? SlidingWindow = null);

/// <summary>An empty object keeps the server's default target.</summary>
public sealed record SlidingWindow;

/// <summary>No handle starts a new session that can be resumed; a handle resumes one.</summary>
public sealed record SessionResumptionConfig(string? Handle = null);

/// <summary>One stream's chunk per message.</summary>
public sealed record RealtimeInput(Blob? Audio = null, Blob? Video = null);

// ---- server → client: one of the message fields per message ----

public sealed record LiveServerMessage(
    SetupComplete? SetupComplete = null,
    ServerContent? ServerContent = null,
    GoAway? GoAway = null,
    SessionResumptionUpdate? SessionResumptionUpdate = null) {
  /// <summary>Fields this client doesn't read (toolCall, usageMetadata, anything new).</summary>
  [JsonExtensionData]
  public Dictionary<string, JsonElement>? Unhandled { get; init; }
}

public sealed record SetupComplete;

public sealed record ServerContent(
    bool Interrupted = false,
    Content? ModelTurn = null,
    Transcription? InputTranscription = null,
    Transcription? OutputTranscription = null);

/// <summary>Proto JSON leaves empty strings off the wire, so a missing Text reads as "".</summary>
public sealed record Transcription(string Text = "");

/// <summary>The server will close the socket soon; TimeLeft is a duration such as "10s".</summary>
public sealed record GoAway(string? TimeLeft = null);

public sealed record SessionResumptionUpdate(bool Resumable = false, string? NewHandle = null);
