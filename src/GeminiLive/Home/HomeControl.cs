using System.Globalization;
using System.Text.RegularExpressions;

namespace GeminiLive.Home;

/// <summary>What the user asked their home to do.</summary>
public enum HomeVerb { Query, On, Off, Brightness, Color, Temperature, Warmer, Cooler, Mode, Fan, Volume, Mute, Unmute }

/// <summary>A parsed request: the devices it names, what to do, and the value it carries.</summary>
public sealed record HomeIntent(IReadOnlyList<HomeDevice> Devices, HomeVerb Verb, object? Value,
                                string Utterance);

/// <summary>
/// Google Home from a spoken request. Gemini Live can't reach Home from Windows (Home is a
/// phone-only Gemini app, and "Ask Home" isn't offered in every country), so we parse the request
/// ourselves against the user's real device list - names, nicknames, rooms, device types - and
/// apply it through <see cref="HomeApi"/>. Each request yields one sentence to show and speak.
/// </summary>
public sealed partial class HomeControl {
  // A device list older than this is reloaded before parsing, so renames and new devices show up.
  private static readonly TimeSpan _devicesMaxAge = TimeSpan.FromMinutes(10);

  private static readonly IReadOnlyDictionary<string, int> _colors = new Dictionary<string, int> {
    ["red"] = 0xFF0000, ["green"] = 0x00FF00, ["blue"] = 0x0000FF, ["white"] = 0xFFFFFF,
    ["warm white"] = 0xFFF8E9, ["cool white"] = 0xFAFFFF, ["yellow"] = 0xFFFF00,
    ["orange"] = 0xFFA500, ["purple"] = 0x800080, ["pink"] = 0xFFC0CB, ["cyan"] = 0x00FFFF,
    ["teal"] = 0x008080, ["magenta"] = 0xFF00FF,
  };

  // Spoken device-type words → Home device types, for "the lights" / "the AC" / "the TV".
  private static readonly (Regex Words, string[] Types)[] _typeWords = [
    (new(@"\b(lights?|lamps?|bulbs?)\b", RegexOptions.IgnoreCase), ["LIGHT"]),
    (new(@"\b(a\.?c|air ?con(ditioner)?|aircon|air conditioning)\b", RegexOptions.IgnoreCase), ["AC_UNIT"]),
    (new(@"\b(tvs?|televisions?)\b", RegexOptions.IgnoreCase), ["TV"]),
    (new(@"\b(fans?)\b", RegexOptions.IgnoreCase), ["FAN"]),
    (new(@"\b(plugs?|outlets?|switch(es)?)\b", RegexOptions.IgnoreCase), ["OUTLET", "SWITCH"]),
  ];

  private readonly HomeApi _api;
  private IReadOnlyList<HomeDevice> _devices = [];
  private DateTime _loadedAt = DateTime.MinValue;
  private IReadOnlyList<HomeDevice> _lastDevices = [];  // for "turn it off"

  public HomeControl(HomeApi api) {
    _api = api;
  }

  /// <summary>Loads the device list now, so the first request doesn't wait for it.</summary>
  public async Task WarmUpAsync() {
    try {
      await DevicesAsync();
    } catch (Exception e) {
      Log.Write($"home: devices unavailable: {e.Message}");
    }
  }

  /// <summary>The request as a home command, or null when it isn't one (or Home isn't reachable).</summary>
  public HomeIntent? Match(string utterance) {
    Refresh();
    return Parse(utterance, _devices, _lastDevices);
  }

  /// <summary>Carries the intent out and says what happened, in one sentence.</summary>
  public async Task<string> RunAsync(HomeIntent intent) {
    _lastDevices = intent.Devices;
    IReadOnlyDictionary<string, HomeTraits> traits =
        await _api.TraitsAsync(intent.Devices.Select(d => d.Id));
    var lines = new List<string>();
    foreach (HomeDevice device in intent.Devices) {
      HomeTraits state = traits.GetValueOrDefault(device.Id) ?? new HomeTraits(
          new Dictionary<string, IReadOnlyDictionary<string, object?>>(),
          new Dictionary<string, IReadOnlyDictionary<string, object?>>());
      try {
        lines.Add(await ApplyAsync(device, state, intent));
      } catch (Exception e) {
        Log.Write($"home: {device.Name} {intent.Verb} failed: {e.Message}");
        lines.Add($"I couldn't reach {device.Name}.");
      }
    }
    return string.Join(" ", lines);
  }

  private async Task<IReadOnlyList<HomeDevice>> DevicesAsync() {
    if (DateTime.UtcNow - _loadedAt > _devicesMaxAge) {
      _devices = await _api.DevicesAsync();
      _loadedAt = DateTime.UtcNow;
      Log.Write($"home: {_devices.Count} devices");
    }
    return _devices;
  }

  /// <summary>Refreshes a stale device list in the background; parsing never waits on the network.</summary>
  private void Refresh() {
    if (DateTime.UtcNow - _loadedAt > _devicesMaxAge) {
      _ = WarmUpAsync();
    }
  }

  // ---- applying ----

  private async Task<string> ApplyAsync(HomeDevice device, HomeTraits state, HomeIntent intent) {
    string name = device.Name;
    switch (intent.Verb) {
      case HomeVerb.On or HomeVerb.Off:
        bool on = intent.Verb == HomeVerb.On;
        await _api.UpdateAsync(device.Id, "onOff", "onOff", on);
        return $"Turned {(on ? "on" : "off")} {name}.";
      case HomeVerb.Brightness:
        int level = (int)intent.Value!;
        await _api.UpdateAsync(device.Id, "brightness", "brightness", level);
        return $"{name} {Is(name)} at {level} percent.";
      case HomeVerb.Color:
        var (colorName, rgb) = ((string, int))intent.Value!;
        await _api.UpdateAsync(device.Id, "color", "colorRGB", rgb);
        return $"{name} {Is(name)} {colorName} now.";
      case HomeVerb.Temperature or HomeVerb.Warmer or HomeVerb.Cooler:
        double current = Number(state.Get("temperatureSetting", "thermostatTemperatureSetpointC")) ?? 24;
        double target = intent.Verb switch {
          HomeVerb.Warmer => current + 1,
          HomeVerb.Cooler => current - 1,
          _ => Convert.ToDouble(intent.Value),
        };
        await _api.UpdateAsync(device.Id, "temperatureSetting", "thermostatTemperatureSetpoint", target);
        return $"Set {name} to {Spoken(target)} degrees.";
      case HomeVerb.Mode:
        string mode = (string)intent.Value!;
        await _api.UpdateAsync(device.Id, "temperatureSetting", "mode", mode);
        return $"{name} {Is(name)} on {mode.Replace('-', ' ')} mode.";
      case HomeVerb.Fan:
        string speed = FanSpeed(state, (string)intent.Value!);
        await _api.UpdateAsync(device.Id, "fanSpeed", "currentFanSpeedSetting", speed);
        return $"{name} fan is on {speed}.";
      case HomeVerb.Volume:
        int volume = (int)intent.Value!;
        await _api.UpdateAsync(device.Id, "volume", "currentVolume", volume);
        return $"{name} volume is {volume}.";
      case HomeVerb.Mute or HomeVerb.Unmute:
        bool mute = intent.Verb == HomeVerb.Mute;
        await _api.UpdateAsync(device.Id, "volume", "isMuted", mute);
        return $"{(mute ? "Muted" : "Unmuted")} {name}.";
      default:
        return Describe(device, state);
    }
  }

  /// <summary>One spoken line of a device's state: on/off, then whatever it measures.</summary>
  private static string Describe(HomeDevice device, HomeTraits state) {
    if (state.Get("deviceStatus", "online") is false) {
      return $"{device.Name} {Is(device.Name)} offline.";
    }
    var parts = new List<string>();
    if (state.Get("onOff", "onOff") is bool on) {
      parts.Add(on ? "on" : "off");
    }
    if (Number(state.Get("brightness", "brightness")) is { } brightness && state.Get("onOff", "onOff") is not false) {
      parts.Add($"at {Spoken(brightness)} percent");
    }
    if (state.Get("temperatureSetting", "mode") is string mode && state.Get("onOff", "onOff") is not false) {
      parts.Add($"{mode.Replace('-', ' ')} mode");
    }
    if (Number(state.Get("temperatureSetting", "thermostatTemperatureSetpointC")) is { } setpoint) {
      parts.Add($"set to {Spoken(setpoint)} degrees");
    }
    if (Number(state.Get("temperatureSetting", "ambientAirTemperatureC")) is { } ambient) {
      parts.Add($"and the room is {Spoken(ambient)} degrees");
    }
    if (Number(state.Get("volume", "currentVolume")) is { } volume) {
      parts.Add($"volume {Spoken(volume)}");
    }
    string verb = Is(device.Name);
    return parts.Count == 0
        ? $"{device.Name} {verb} connected."
        : $"{device.Name} {verb} {string.Join(", ", parts)}.";
  }

  // "PC Lights are", "AC is": a name ending in a plain plural s reads as plural.
  private static string Is(string name) {
    return name.EndsWith('s') && !name.EndsWith("ss") ? "are" : "is";
  }

  // The device's own speed name for a spoken word ("fast" → "high"), from its synonym list.
  private static string FanSpeed(HomeTraits state, string spoken) {
    if (state.Attributes.GetValueOrDefault("fanSpeed")?.GetValueOrDefault("availableFanSpeeds")
            is IReadOnlyDictionary<string, object?> available
        && available.GetValueOrDefault("speeds") is List<object?> speeds) {
      foreach (var speed in speeds.OfType<IReadOnlyDictionary<string, object?>>()) {
        var synonyms = (speed.GetValueOrDefault("speed_values") as List<object?> ?? [])
            .OfType<IReadOnlyDictionary<string, object?>>()
            .SelectMany(v => v.GetValueOrDefault("speed_synonym") as List<object?> ?? [])
            .OfType<string>();
        if (synonyms.Contains(spoken, StringComparer.OrdinalIgnoreCase)) {
          return (string)speed["speed_name"]!;
        }
      }
    }
    return spoken;
  }

  private static double? Number(object? value) => value is double d ? d : null;

  private static string Spoken(double value) => Math.Round(value, 1).ToString(CultureInfo.InvariantCulture);

  // ---- parsing ----

  /// <summary>
  /// The request as an intent, or null. A request is a home command when it names devices (by
  /// name, nickname, room or type, or "it" for the last ones) AND asks something of them.
  /// </summary>
  public static HomeIntent? Parse(string utterance, IReadOnlyList<HomeDevice> devices,
                                  IReadOnlyList<HomeDevice> lastDevices) {
    if (devices.Count == 0 || string.IsNullOrWhiteSpace(utterance)) {
      return null;
    }
    string text = Normalize(utterance);
    if (Verb(text) is not var (verb, value)) {
      return null;
    }
    IReadOnlyList<HomeDevice> targets = Targets(text, devices);
    if (targets.Count == 0 && Pronoun().IsMatch(text)) {
      targets = lastDevices;
    }
    if (targets.Count == 0 && verb is not (HomeVerb.On or HomeVerb.Off or HomeVerb.Query)) {
      // "set it to 22 degrees", "fan to high": the setting itself says which devices can take it.
      targets = devices.Where(d => d.Type != "DEVICE_GROUP").ToList();
    }
    if (verb == HomeVerb.Query && Climate().IsMatch(text)
        && targets.Any(d => d.Has("TemperatureSetting"))) {
      targets = targets.Where(d => d.Has("TemperatureSetting")).ToList();
    }
    targets = targets.Where(d => Supports(d, verb)).ToList();
    return targets.Count == 0 ? null : new HomeIntent(targets, verb, value, utterance);
  }

  // Only a question about device state, or a command verb, counts - so ordinary chat that happens
  // to mention a room or "the TV" never reaches the home.
  private static (HomeVerb, object?)? Verb(string text) {
    if (Question().IsMatch(text)) {
      return StateWord().IsMatch(text) ? (HomeVerb.Query, null) : null;
    }
    if (!Command().IsMatch(text)) {
      return null;
    }
    if (Degrees().Match(text) is { Success: true } degrees) {
      return (HomeVerb.Temperature, double.Parse(degrees.Groups[1].Value, CultureInfo.InvariantCulture));
    }
    if (Warmer().IsMatch(text)) {
      return (HomeVerb.Warmer, null);
    }
    if (Cooler().IsMatch(text)) {
      return (HomeVerb.Cooler, null);
    }
    if (ModeWord().Match(text) is { Success: true } mode) {
      string spoken = mode.Groups[1].Success ? mode.Groups[1].Value : mode.Groups[2].Value;
      return (HomeVerb.Mode, spoken.Replace("fan only", "fan-only"));
    }
    if (FanWord().Match(text) is { Success: true } fan) {
      return (HomeVerb.Fan, fan.Groups[1].Value);
    }
    if (VolumeWord().Match(text) is { Success: true } volume) {
      return (HomeVerb.Volume, int.Parse(volume.Groups[1].Value, CultureInfo.InvariantCulture));
    }
    if (Unmute().IsMatch(text)) {
      return (HomeVerb.Unmute, null);
    }
    if (Mute().IsMatch(text)) {
      return (HomeVerb.Mute, null);
    }
    if (Percent().Match(text) is { Success: true } percent) {
      return (HomeVerb.Brightness, Math.Clamp(int.Parse(percent.Groups[1].Value, CultureInfo.InvariantCulture), 1, 100));
    }
    foreach ((string name, int rgb) in _colors.OrderByDescending(c => c.Key.Length)) {
      if (Regex.IsMatch(text, $@"\b{name}\b")) {
        return (HomeVerb.Color, (name, rgb));
      }
    }
    if (Off().IsMatch(text)) {
      return (HomeVerb.Off, null);
    }
    if (On().IsMatch(text)) {
      return (HomeVerb.On, null);
    }
    return null;
  }

  private static bool Supports(HomeDevice device, HomeVerb verb) {
    return verb switch {
      HomeVerb.Query => true,
      HomeVerb.On or HomeVerb.Off => device.Has("OnOff"),
      HomeVerb.Brightness => device.Has("Brightness"),
      HomeVerb.Color => device.Has("ColorSetting"),
      HomeVerb.Temperature or HomeVerb.Warmer or HomeVerb.Cooler or HomeVerb.Mode =>
          device.Has("TemperatureSetting"),
      HomeVerb.Fan => device.Has("FanSpeed"),
      _ => device.Has("Volume"),
    };
  }

  /// <summary>
  /// The devices the text names. Names and nicknames win (longest first, so "custom ac" beats
  /// "ac"); otherwise a type word ("the lights"), narrowed to a named room when there is one.
  /// </summary>
  private static IReadOnlyList<HomeDevice> Targets(string text, IReadOnlyList<HomeDevice> devices) {
    var named = new List<HomeDevice>();
    var taken = new List<(int Start, int End)>();
    var labels = devices
        .SelectMany(d => d.Nicknames.Prepend(d.Name).Select(label => (Device: d, Label: Normalize(label))))
        .Where(x => x.Label.Length > 0)
        .OrderByDescending(x => x.Label.Length);
    foreach ((HomeDevice device, string label) in labels) {
      foreach (Match m in Regex.Matches(text, $@"\b{Regex.Escape(label)}\b")) {
        if (taken.Any(t => m.Index < t.End && t.Start < m.Index + m.Length)) {
          continue;  // inside a longer name already matched
        }
        taken.Add((m.Index, m.Index + m.Length));
        if (!named.Contains(device)) {
          named.Add(device);
        }
      }
    }
    if (named.Count > 0) {
      return named;
    }

    string? room = devices.Select(d => d.Room).OfType<string>().Distinct()
        .OrderByDescending(r => r.Length)
        .FirstOrDefault(r => Regex.IsMatch(text, $@"\b{Regex.Escape(Normalize(r))}\b"));
    IEnumerable<HomeDevice> pool = devices.Where(d => d.Type != "DEVICE_GROUP")
        .Where(d => room is null || d.Room == room);
    foreach ((Regex words, string[] types) in _typeWords) {
      if (words.IsMatch(text)) {
        return pool.Where(d => types.Contains(d.Type)).ToList();
      }
    }
    // "turn off everything in the office" / "is anything on in my room": a room alone means
    // every device in it.
    return room is not null && (Everything().IsMatch(text) || Question().IsMatch(text))
        ? pool.ToList()
        : [];
  }

  private static string Normalize(string text) {
    return Spaces().Replace(NonWord().Replace(text.ToLowerInvariant(), " "), " ").Trim();
  }

  [GeneratedRegex(@"[^\p{L}\p{N}%.]+")]
  private static partial Regex NonWord();

  [GeneratedRegex(@"\s+")]
  private static partial Regex Spaces();

  [GeneratedRegex(@"^(is|are|what|whats|what's|how|which|do i|did i)\b|\b(status|still on)\b")]
  private static partial Regex Question();

  [GeneratedRegex(@"\b(on|off|temperature|degrees|hot|cold|warm|brightness|bright|volume|running|status)\b")]
  private static partial Regex StateWord();

  [GeneratedRegex(@"\b(turn|switch|power|shut|flip|kill|put|set|make|change|dim|brighten|raise|lower|increase|decrease|mute|unmute)\b")]
  private static partial Regex Command();

  [GeneratedRegex(@"\b(\d{2}(?:\.\d)?)\s*(degrees?|°|celsius)")]
  private static partial Regex Degrees();

  [GeneratedRegex(@"\b(warmer|hotter|heat it up|turn up the (heat|temperature))\b")]
  private static partial Regex Warmer();

  [GeneratedRegex(@"\b(cooler|colder|cool it down|turn down the (heat|temperature))\b")]
  private static partial Regex Cooler();

  [GeneratedRegex(@"\b(cool|heat|dry|fan only|auto)\s+mode\b|\bmode\s+(?:to\s+)?(cool|heat|dry|fan only|auto)\b")]
  private static partial Regex ModeWord();

  [GeneratedRegex(@"\bfan\s+(?:speed\s+)?(?:to\s+|on\s+)?(low|slow|medium|normal|high|fast|turbo|auto|automatic)\b")]
  private static partial Regex FanWord();

  [GeneratedRegex(@"\bvolume\s+(?:to\s+|at\s+)?(\d{1,3})\b")]
  private static partial Regex VolumeWord();

  [GeneratedRegex(@"\bunmute\b")]
  private static partial Regex Unmute();

  [GeneratedRegex(@"\bmute\b")]
  private static partial Regex Mute();

  [GeneratedRegex(@"\b(\d{1,3})\s*(%|percent)")]
  private static partial Regex Percent();

  [GeneratedRegex(@"\b(off|shut down|shut off|kill)\b")]
  private static partial Regex Off();

  [GeneratedRegex(@"\b(on|start|power up)\b")]
  private static partial Regex On();

  [GeneratedRegex(@"\b(it|them|those|that)\b")]
  private static partial Regex Pronoun();

  [GeneratedRegex(@"\b(temperature|degrees|hot|cold|warm)\b")]
  private static partial Regex Climate();

  [GeneratedRegex(@"\b(everything|all|anything)\b")]
  private static partial Regex Everything();
}
