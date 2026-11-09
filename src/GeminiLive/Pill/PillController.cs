using System.Windows.Threading;

namespace GeminiLive;

/// <summary>
/// Googlebook's Live UI on Windows, minus the drawing: the session behind the pill (docked above the
/// taskbar: share, mic, status, settings, end) and the caption card above it. It owns every piece of
/// state and all the logic, and shows it as one <see cref="PillView"/> for the Svelte window
/// (<see cref="PillHost"/>), which sends back <see cref="PillAction"/>s (PillController.Actions.cs).
/// </summary>
public sealed partial class PillController : IDisposable {
  private readonly HostWindow _window;
  private readonly Settings _settings = Settings.Load();
  private readonly UpdateChecker _updates;
  private readonly Glic.GlicHost _glic;
  private readonly Glic.HomeHost _home;
  private readonly CaptionLog _captions = new();
  private readonly GlowState _glow = new();
  private readonly ScreenFocus _focus;
  private readonly PillHost _host;

  private ILiveEngine? _conversation;
  private MonitorInfo? _pillMonitor;
  private IReadOnlyList<MonitorInfo> _displays = [];
  private IReadOnlyList<PillNamed> _microphones = [];
  // The pill's exit animation runs 260 ms in the window (pill/src/ui/motion/motion.ts), then it hides
  private static readonly TimeSpan _exitSettle = TimeSpan.FromMilliseconds(400);
  private static readonly TimeSpan _pillShowSettle = TimeSpan.FromMilliseconds(250);

  private readonly PreviousApp _previousApp;
  private bool _isShown;
  private bool _muted;
  private string _status = "";
  private string _statusDetail = "";
  private bool _isExtensionNeeded;
  private bool _isExtensionStepsShown;
  private bool _isKeyPromptShown;
  private bool _isFocusable;

  private MonitorInfo? Shared => _conversation?.Monitor;

  private Dispatcher Dispatcher => _window.Dispatcher;

  public PillController(HostWindow window, Glic.GlicHost glic, Glic.HomeHost home) {
    _window = window;
    _glic = glic;
    _home = home;
    _focus = new ScreenFocus(window.Handle, () => _conversation);
    _host = new PillHost(action => Dispatcher.InvokeAsync(() => Apply(action)).Task.Unwrap());
    _previousApp = new PreviousApp(() => _host.WindowHandle);
    _updates = new UpdateChecker(_settings);

    _focus.Changed += Changed;
    _captions.Changed += Changed;
    _updates.ReadyChanged += Changed;
    window.DisplaysChanged += OnDisplaysChanged;
    glic.ExtensionNeeded += OnExtensionNeeded;
    glic.SetMicrophone(_settings.MicrophoneId);

    _displays = Monitors.All();
    Changed();
    _host.Start();
    _ = _updates.WatchAsync();
  }

  public void Dispose() {
    _previousApp.Dispose();
    _host.Dispose();
  }

  // ---- the view ----

  private PillView Render() {
    return new PillView(
        Status: _status,
        StatusDetail: _statusDetail,
        IsMuted: _muted,
        Lines: [.. _captions.Lines],
        Links: [.. _captions.Links],
        Displays: [.. _displays.Select(display => new PillNamed(display.DeviceName, display.Description))],
        SharedDisplay: Shared?.DeviceName,
        SharedDisplayName: Shared?.Name,
        IsExtensionNeeded: _isExtensionNeeded,
        IsExtensionStepsShown: _isExtensionStepsShown,
        IsKeyPromptShown: _isKeyPromptShown,
        Engine: _settings.Engine,
        Microphones: _microphones,
        MicrophoneId: _settings.MicrophoneId,
        IsCameraAvailable: _settings.Engine == EngineKind.Google,
        IsCameraShared: _glic.View.UseCamera,
        Update: UpdateMenu.Describe(_updates, _settings),
        Glow: _glow.Current,
        IsShown: _isShown,
        IsFocusable: _isFocusable);
  }

  private void Changed() {
    _host.Publish(Render());
  }

  // ---- Copilot key ----

  public void OnTrigger(KeyTrigger trigger) {
    Log.Write($"trigger {trigger}");
    switch (trigger) {
      case KeyTrigger.Tap when _conversation is not null:
        _ = EndAsync();
        break;
      case KeyTrigger.Tap:
      case KeyTrigger.HoldStart when _conversation is null:
        _ = StartAsync(Monitors.Active());
        break;
      case KeyTrigger.HoldStart:
        SetMuted(false);
        break;
    }
  }

  // ---- Circle to Search (CircleKey) ----

  public void OnCircle() {
    if (_focus.IsCircling) {
      return;  // a second press while the overlay is up
    }

    _ = CircleAsync();
  }

  /// <summary>
  /// Freezes the display under the pointer for the user to circle something, then sends the crop on: to
  /// Lens, or to Gemini as what it sees, starting a conversation if none is running.
  /// </summary>
  private async Task CircleAsync() {
    _focus.IsCircling = true;
    try {
      MonitorInfo monitor = Monitors.UnderCursor();
      bool live = _conversation is not null;
      Log.Write($"circle on {monitor.Description}{(live ? " (Live running)" : "")}");
      // While Live runs, the loop itself is the request: no buttons, it focuses on release.
      CircleSelection? selection = await CircleOverlay.SelectAsync(monitor, askOnRelease: live);
      if (selection is null) {
        return;
      }

      if (selection.Action == CircleAction.Lens) {
        await LensSearch.SearchAsync(selection.Crop);
        return;
      }

      if (_conversation is null) {
        await StartAsync(monitor);
      }

      _focus.FocusOn(monitor, selection.Region);
    } finally {
      _focus.IsCircling = false;
    }
  }

  // ---- session lifetime ----

  private async Task StartAsync(MonitorInfo monitor) {
    _captions.Clear();
    ShowOn(monitor);

    if (_settings.Engine == EngineKind.ApiKey && !_settings.HasApiKey) {
      AskForKey();
      return;
    }

    ILiveEngine engine = CreateEngine(monitor);
    _conversation = engine;
    engine.Status += status => WhileCurrent(engine, () => SetStatus(status));
    engine.Transcript += (text, isUser) => WhileCurrent(engine, () => _captions.Show(text, isUser));
    engine.Links += links => WhileCurrent(engine, () => _captions.ShowLinks(links));
    engine.Level += (level, isUser) => WhileCurrent(engine, () => FollowLevel(level, isUser));
    engine.Ended += reason => WhileCurrent(engine, () => Fail(engine, reason));

    SetStatus(LiveStatus.Connecting);
    _focus.Cover(monitor);
    try {
      await engine.StartAsync();

      if (_conversation != engine) {
        return;  // ended while connecting
      }

      SetStatus(LiveStatus.Listening);

      if (!engine.ReportsLevels) {
        _glow.Breathe();
      }

      SetMuted(false);
      _ = RefreshMicrophonesAsync();
    } catch (Exception e) {
      if (_conversation != engine) {
        return;
      }

      Log.Write($"start failed: {e}");
      Fail(engine, e.Message);

      if (e.Message.Contains("API key", StringComparison.OrdinalIgnoreCase)) {
        AskForKey();
      }
    }
  }

  private ILiveEngine CreateEngine(MonitorInfo monitor) {
    if (_settings.Engine == EngineKind.Google) {
      return new Glic.GlicConversation(_glic, _home, monitor);
    }

    return new Conversation(_settings, monitor);
  }

  /// <summary>Runs an engine's event on the UI thread, unless that engine was replaced.</summary>
  private void WhileCurrent(ILiveEngine engine, Action action) {
    Dispatcher.BeginInvoke(() => {
      if (_conversation == engine) {
        action();
      }
    });
  }

  private void FollowLevel(float level, bool isUser) {
    _glow.Follow(level, isUser);
    Changed();
  }

  /// <summary>A session died: keep the pill up with the reason, so the failure shows.</summary>
  private void Fail(ILiveEngine engine, string reason) {
    if (_conversation != engine) {
      return;
    }

    Log.Write($"ended: {reason}");
    Detach();
    SetStatus(LiveStatus.Stopped, detail: reason);
    _captions.AddNote(reason);
    _ = engine.DisposeAsync().AsTask();
  }

  private async Task EndAsync() {
    ILiveEngine? engine = _conversation;
    Detach();
    _isShown = false;
    Changed();
    _ = RestoreFocusAsync();

    if (engine is not null) {
      await engine.DisposeAsync();
    }
  }

  /// <summary>Once the pill's exit has finished and its window is gone, hands focus back.</summary>
  private async Task RestoreFocusAsync() {
    await Task.Delay(_exitSettle);
    Dispatcher.Invoke(_previousApp.Restore);
  }

  /// <summary>Lets go of the session: no more events, no share border, glow at rest.</summary>
  private void Detach() {
    _conversation = null;
    _focus.HideBorder();
    _focus.Unfocus();
    _glow.Rest();
    Changed();
  }

  /// <summary>Ends whatever runs and starts again on the current settings and display.</summary>
  private async Task RestartAsync() {
    MonitorInfo monitor = Shared ?? _pillMonitor ?? Monitors.Active();
    ILiveEngine? engine = _conversation;
    Detach();

    if (engine is not null) {
      await engine.DisposeAsync();
    }

    await StartAsync(monitor);
  }

  // ---- placement and sharing: which display Gemini sees ----

  private void ShowOn(MonitorInfo monitor) {
    if (!_isShown) {
      _ = _previousApp.SettleAsync();
      _ = KeepPillOnTopAsync();
    }

    _pillMonitor = monitor;
    _isKeyPromptShown = false;
    _isExtensionNeeded = false;
    _isExtensionStepsShown = false;
    _isShown = true;
    _displays = Monitors.All();
    _ = RefreshMicrophonesAsync();
    Changed();
  }

  private async Task KeepPillOnTopAsync() {
    await Task.Delay(_pillShowSettle);
    Overlay.KeepOnTop(_host.WindowHandle);
  }

  private void Share(MonitorInfo monitor) {
    if (_conversation is null) {
      return;
    }

    _conversation.Share(monitor);
    _focus.Cover(monitor);
    _focus.Unfocus();  // sharing a display shares all of it
    Log.Write($"sharing {monitor.Description}");
  }

  /// <summary>Displays plugged in or out: keep sharing one that survived, and re-dock.</summary>
  private void OnDisplaysChanged() {
    _displays = Monitors.All();
    Log.Write($"displays changed: {_displays.Count}");

    // Re-share even when the display survived: its bounds may have moved.
    if (Shared is { } shared) {
      Share(Monitors.Reconcile(_displays, shared));
    }

    if (_pillMonitor is { } docked) {
      _pillMonitor = Monitors.Reconcile(_displays, docked);
    }

    Changed();
  }

  // ---- status and the setup panels ----

  private void SetStatus(string status, string? detail = null) {
    _status = status;
    _statusDetail = detail ?? "";
    Changed();
  }

  private void OnExtensionNeeded(bool needed) {
    if (needed && _settings.Engine != EngineKind.Google) {
      return;  // a Google session still winding down after a switch to the API key
    }

    _isExtensionNeeded = needed;

    if (!needed) {
      _isExtensionStepsShown = false;
    }

    Changed();
  }

  private void AskForKey() {
    // A running session keeps its status: changing the key can still be cancelled.
    if (_conversation is null) {
      SetStatus(LiveStatus.NeedsApiKey);
    }

    _isKeyPromptShown = true;
    _isFocusable = true;  // typing needs focus, so the window drops no-activate just for this
    Changed();
  }

  /// <summary>
  /// Selecting transcript text, or typing a key, needs the window to hold focus or Ctrl+C and the keys
  /// go to the app underneath: it takes the foreground. It stops being focusable when it loses
  /// activation (the window asks), unless the key prompt still waits for typing.
  /// </summary>
  private void SetFocusable(bool isFocusable) {
    _isFocusable = isFocusable || _isKeyPromptShown;

    if (!isFocusable) {
      return;
    }

    Overlay.BringToFront(_host.WindowHandle);
  }

  private void HideKeyPanel() {
    _isKeyPromptShown = false;
    _isFocusable = false;
    Changed();
  }

  // ---- controls ----

  private void SetMuted(bool muted) {
    _muted = muted;

    if (_conversation is not null) {
      _conversation.Muted = muted;
    }

    Changed();
  }

  /// <summary>
  /// Saves the choice, and starts the open pill over on it.
  /// </summary>
  private async Task SwitchEngineAsync(EngineKind kind) {
    if (_settings.Engine == kind) {
      return;
    }

    _settings.Engine = kind;
    _settings.Save();
    Log.Write($"engine -> {kind}");
    HideKeyPanel();

    if (kind != EngineKind.Google) {
      OnExtensionNeeded(false);
    }

    if (_isShown) {
      await RestartAsync();
    }
  }

  /// <summary>Like Win+H's flyout lists them: every microphone Gemini's page can open.</summary>
  private async Task RefreshMicrophonesAsync() {
    IReadOnlyList<(string Id, string Name)> found = await _glic.ListMicrophonesAsync();
    _microphones = [.. found.Select(microphone => new PillNamed(microphone.Id, microphone.Name))];
    Changed();
  }
}
