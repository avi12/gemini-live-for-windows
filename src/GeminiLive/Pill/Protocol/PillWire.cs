using System.Text.Json;
using System.Text.Json.Nodes;

namespace GeminiLive;

/// <summary>
/// The request types of the state protocol (winui-svelte/src/state/README.md; wire value:
/// <see cref="WireName"/>).
/// </summary>
public enum PillFrameType {
  Snapshot,
  Action,
}

/// <summary>A request frame from the window. <see cref="Type"/> is null for a type nobody handles.</summary>
public sealed record PillRequest(JsonElement Id, PillFrameType? Type, string RawType, JsonElement Data);

/// <summary>A request frame we send: <c>{id, type, data, timestamp}</c>.</summary>
public sealed record PillFrame(long Id, PillFrameType Type, JsonNode Data, long Timestamp);

/// <summary>The data of a snapshot: the whole value of one named state.</summary>
public sealed record PillSnapshot(string Name, PillView Value);

/// <summary>A response frame that says it worked: <c>{id, response: null}</c>.</summary>
public sealed record PillAck(JsonElement Id, string? Response);

/// <summary>A response frame that says it did not: <c>{id, error}</c>.</summary>
public sealed record PillRefusal(JsonElement Id, string Error);

/// <summary>One JSON line per frame, both ways.</summary>
public static class PillWire {
  private const string _idField = "id";
  private const string _typeField = "type";
  private const string _dataField = "data";
  private const string _errorField = "error";

  /// <summary>The snapshot's data, and its text, which says whether anything changed since the last one.</summary>
  public static JsonNode SnapshotData(PillView view) {
    return JsonSerializer.SerializeToNode(new PillSnapshot(PillView.Name, view), WireName.Json)!;
  }

  public static string Snapshot(long id, JsonNode data) {
    long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return JsonSerializer.Serialize(new PillFrame(id, PillFrameType.Snapshot, data, timestamp), WireName.Json);
  }

  public static string Answer(JsonElement id, string? error) {
    return error is null
        ? JsonSerializer.Serialize(new PillAck(id, null), WireName.Json)
        : JsonSerializer.Serialize(new PillRefusal(id, error), WireName.Json);
  }

  /// <summary>
  /// The request on a line; null for a response to one of ours (an error in it is logged) or a line
  /// that is not a frame.
  /// </summary>
  public static PillRequest? ReadRequest(string line) {
    try {
      using JsonDocument document = JsonDocument.Parse(line);
      JsonElement root = document.RootElement;
      if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(_idField, out JsonElement id)) {
        Log.Write($"pill: not a frame: {line}");
        return null;
      }

      if (!root.TryGetProperty(_typeField, out JsonElement type)) {
        LogRefusal(root);
        return null;
      }

      string rawType = type.GetString() ?? "";
      root.TryGetProperty(_dataField, out JsonElement data);
      return new PillRequest(id.Clone(), WireName.Parse<PillFrameType>(rawType), rawType, data.Clone());
    } catch (JsonException e) {
      Log.Write($"pill: unreadable line: {e.Message}");
      return null;
    }
  }

  private static void LogRefusal(JsonElement response) {
    if (response.TryGetProperty(_errorField, out JsonElement error)) {
      Log.Write($"pill: the window refused a frame: {error}");
    }
  }
}
