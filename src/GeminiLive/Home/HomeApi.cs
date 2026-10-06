using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using GeminiLive.Glic;

namespace GeminiLive.Home;

/// <summary>One device in the user's Google Home, as Home for web lists it.</summary>
public sealed record HomeDevice(string Id, string Name, IReadOnlyList<string> Nicknames,
                                string? Room, string Type, IReadOnlyList<string> Traits) {
  public bool Has(string trait) => Traits.Contains(trait);
}

/// <summary>A device's live traits: trait name → its state and its attributes.</summary>
public sealed record HomeTraits(IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> State,
                                IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> Attributes) {
  public object? Get(string trait, string key) {
    return State.TryGetValue(trait, out var values) ? values.GetValueOrDefault(key) : null;
  }
}

/// <summary>
/// Google Home over the same API Home for web (home.google.com) calls - "Foyer", grpc-web in
/// JSON+protobuf form - signed with the user's own browser session (SAPISIDHASH over SAPISID), the
/// way every Google web app authorizes its API calls. No page, no phone: the app talks to the
/// user's home directly. Values travel as google.protobuf.Value in jspb arrays (see <see cref="Encode"/>).
/// </summary>
public sealed class HomeApi {
  private const string _endpoint =
      "https://googlehomefoyer-pa.clients6.google.com/$rpc/google.internal.home.foyer.v1.";
  // Home for web's public browser key, the one its page sends; it identifies the client, not the user.
  private const string _apiKey = "***REMOVED***";
  private const string _origin = "https://home.google.com";

  // Ask GetHomeGraph for every device-type bucket Home for web asks for.
  private static readonly JsonArray _graphRequest = JsonNode.Parse(
      "[null,null,null,null,null,null,null,1,null,[1,2],null,null,null,null," +
      "[1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,20]]")!.AsArray();

  private static readonly HttpClient _http = new(new HttpClientHandler { UseCookies = false }) {
    Timeout = TimeSpan.FromSeconds(10),
  };

  private readonly Func<IReadOnlyList<GoogleCookie>> _session;

  public HomeApi(Func<IReadOnlyList<GoogleCookie>> session) {
    _session = session;
  }

  /// <summary>Every device in every home the account can reach, with its room.</summary>
  public async Task<IReadOnlyList<HomeDevice>> DevicesAsync() {
    JsonNode? reply = await CallAsync("StructuresService/GetHomeGraph", _graphRequest.DeepClone());
    var devices = new List<HomeDevice>();
    foreach (JsonNode? home in Items(At(reply, 1))) {
      var rooms = new Dictionary<string, string>();
      foreach (JsonNode? room in Items(At(home, 5))) {
        string name = Text(At(room, 2)) ?? "";
        foreach (JsonNode? member in Items(At(room, 4))) {
          if (Text(At(member, 0, 0)) is { } id) {
            rooms[id] = name;
          }
        }
      }
      foreach (JsonNode? device in Items(At(home, 6))) {
        if (Text(At(device, 0, 0)) is not { } id) {
          continue;
        }
        devices.Add(new HomeDevice(
            id,
            Text(At(device, 3)) ?? "",
            Strings(At(device, 15)),
            rooms.GetValueOrDefault(id),
            (Text(At(device, 5)) ?? "").Replace("action.devices.types.", ""),
            Strings(At(device, 6)).Select(t => t.Replace("action.devices.traits.", "")).ToList()));
      }
    }
    return devices;
  }

  /// <summary>Live state and attributes for the given devices, by device id.</summary>
  public async Task<IReadOnlyDictionary<string, HomeTraits>> TraitsAsync(IEnumerable<string> ids) {
    var request = new JsonArray(new JsonArray(ids.Select(id => (JsonNode)new JsonArray(id)).ToArray()));
    JsonNode? reply = await CallAsync("HomeControlService/GetTraits", request);
    var result = new Dictionary<string, HomeTraits>();
    foreach (JsonNode? device in Items(At(reply, 0))) {
      if (Text(At(device, 0, 0)) is not { } id) {
        continue;
      }
      var state = new Dictionary<string, IReadOnlyDictionary<string, object?>>();
      var attributes = new Dictionary<string, IReadOnlyDictionary<string, object?>>();
      foreach (JsonNode? trait in Items(At(device, 1))) {
        string name = Text(At(trait, 0)) ?? "";
        state[name] = Struct(At(trait, 1));
        attributes[name] = Struct(At(trait, 2, 0));
      }
      result[id] = new HomeTraits(state, attributes);
    }
    return result;
  }

  /// <summary>
  /// Sets one state value on a device (e.g. onOff/onOff = false). Throws when Home ignores it: an
  /// unknown key comes back as an empty reply rather than an error.
  /// </summary>
  public async Task UpdateAsync(string id, string trait, string key, object value) {
    var entry = new JsonArray(key, Encode(value));
    var traits = new JsonArray(new JsonArray(trait, new JsonArray(entry)));
    var request = new JsonArray(new JsonArray(new JsonArray(new JsonArray(id), traits)));
    JsonNode? reply = await CallAsync("HomeControlService/UpdateTraits", request);
    if (reply is not JsonArray { Count: > 0 }) {
      throw new InvalidOperationException($"Google Home ignored {trait}.{key}");
    }
  }

  private async Task<JsonNode?> CallAsync(string method, JsonNode body) {
    IReadOnlyList<GoogleCookie> session = _session();
    // The API host only sees cookies scoped to the whole google.com domain.
    List<GoogleCookie> cookies = session.Where(c => c.Domain == ".google.com").ToList();
    string sapisid = cookies.FirstOrDefault(c => c.Name == "SAPISID")?.Value
        ?? throw new InvalidOperationException("No Google session for Home");
    using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint + method) {
      Content = new StringContent(body.ToJsonString(), Encoding.UTF8),
    };
    request.Content.Headers.ContentType = new("application/json+protobuf");
    request.Headers.Add("Authorization", SapisidHash(sapisid));
    request.Headers.Add("X-Goog-Api-Key", _apiKey);
    request.Headers.Add("X-Goog-AuthUser", "0");
    request.Headers.Add("Origin", _origin);
    request.Headers.Add("Cookie", string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}")));
    using HttpResponseMessage response = await _http.SendAsync(request);
    string text = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode) {
      throw new HttpRequestException($"Google Home {method}: {(int)response.StatusCode} {text}");
    }
    return JsonNode.Parse(text);
  }

  // Google's web-session API signature: SHA-1 of "<unix seconds> <SAPISID> <origin>".
  private static string SapisidHash(string sapisid) {
    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    byte[] digest = SHA1.HashData(Encoding.UTF8.GetBytes($"{now} {sapisid} {_origin}"));
    return $"SAPISIDHASH {now}_{Convert.ToHexString(digest).ToLowerInvariant()}";
  }

  // ---- google.protobuf.Value in jspb: [null, number] / [_, _, string] / [_, _, _, bool] /
  //      [_, _, _, _, [entries]] struct / [_, _, _, _, _, [values]] list ----

  private static JsonArray Encode(object value) {
    var slots = new JsonNode?[6];
    switch (value) {
      case bool b:
        slots[3] = b ? 1 : 0;
        return new JsonArray(slots[..4]);
      case string s:
        slots[2] = s;
        return new JsonArray(slots[..3]);
      case IReadOnlyDictionary<string, object> map:
        slots[4] = new JsonArray(new JsonArray(
            map.Select(kv => (JsonNode)new JsonArray(kv.Key, Encode(kv.Value))).ToArray()));
        return new JsonArray(slots[..5]);
      default:
        slots[1] = Convert.ToDouble(value);
        return new JsonArray(slots[..2]);
    }
  }

  private static object? Decode(JsonNode? value) {
    if (At(value, 1) is { } number) {
      return number.GetValue<double>();
    }
    if (At(value, 2) is { } text) {
      return text.GetValue<string>();
    }
    if (At(value, 3) is { } flag) {
      return flag.GetValue<int>() != 0;
    }
    if (At(value, 4) is { } map) {
      return Struct(At(map, 0));
    }
    if (At(value, 5) is { } list) {
      return Items(At(list, 0)).Select(Decode).ToList();
    }
    return null;
  }

  private static IReadOnlyDictionary<string, object?> Struct(JsonNode? entries) {
    var result = new Dictionary<string, object?>();
    foreach (JsonNode? entry in Items(entries)) {
      if (Text(At(entry, 0)) is { } key) {
        result[key] = Decode(At(entry, 1));
      }
    }
    return result;
  }

  // jspb drops trailing empty fields, so arrays are often shorter than the schema: every read goes
  // through At, which treats a missing slot (or a non-array) as null instead of throwing.
  private static JsonNode? At(JsonNode? node, params int[] path) {
    foreach (int i in path) {
      if (node is not JsonArray array || i >= array.Count) {
        return null;
      }
      node = array[i];
    }
    return node;
  }

  private static IEnumerable<JsonNode?> Items(JsonNode? node) {
    return node as JsonArray ?? [];
  }

  private static string? Text(JsonNode? node) {
    return node is JsonValue value && value.TryGetValue(out string? text) ? text : null;
  }

  private static IReadOnlyList<string> Strings(JsonNode? array) {
    return Items(array).Select(Text).OfType<string>().ToList();
  }
}
