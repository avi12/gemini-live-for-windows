using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Navigation;
using Microsoft.Win32;

namespace GeminiLive;

/// <summary>
/// Googlebook's Live UI on Windows: a pill docked above the taskbar (share, mic, status, settings,
/// end) under a caption card with the running transcript and the links Gemini mentioned.
/// </summary>
public partial class MainWindow : Window {
  private const int _dockGap = 6;  // physical px between the pill's glow margin and the taskbar
  // How the pill arrives and leaves (Material enter/exit, rising from the taskbar).
  private const double _pillRise = 24;
  private const double _pillSink = 40;  // a longer drop on the way out, so the close reads clearly
  private const double _pillScaleFrom = 0.96;
  private const double _cardRise = 12;
  private const double _menuRise = 8;

  private readonly Settings _settings = Settings.Load();
  private readonly ShareBorder _border = new();
  private readonly Glic.GlicHost _glic;
  private readonly Glic.HomeHost _home;
  private readonly CaptionPresenter _captions;
  private readonly GlowAnimator _glow;

  public IntPtr Handle { get; }

  private ILiveEngine? _conversation;
  private MonitorInfo? _pendingMonitor;
  private MonitorInfo? _dockedOn;
  private bool _leaving;  // the exit animation is running; Hide() follows unless shown again
  private bool _muted;
  private string _status = "";

  private MonitorInfo? Shared => _conversation?.Monitor;

  public MainWindow(Glic.GlicHost glic, Glic.HomeHost home) {
    _glic = glic;
    _home = home;
    InitializeComponent();
    Handle = Overlay.Prepare(this, clickThrough: false);
    _glow = new GlowAnimator(Glow);
    _captions = new CaptionPresenter(Transcript, TranscriptScroll, LinkTray);
    _captions.Changed += UpdateCard;
    glic.ExtensionNeeded += OnExtensionNeeded;
    glic.SetMicrophone(_settings.MicrophoneId);
    SizeChanged += (_, e) => Dock(e.NewSize);
    SystemEvents.DisplaySettingsChanged += (_, _) => Dispatcher.BeginInvoke(OnDisplaysChanged);
    SettingsButton.ContextMenu = BuildSettingsMenu();
    SetMuted(false);
    UpdateShareButton();
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

  // ---- session lifetime ----

  private async Task StartAsync(MonitorInfo monitor) {
    _captions.Clear();
    ShowOn(monitor);
    if (_settings.Engine == EngineKind.ApiKey && !_settings.HasApiKey) {
      _pendingMonitor = monitor;
      AskForKey();
      return;
    }

    ILiveEngine engine = CreateEngine(monitor);
    _conversation = engine;
    engine.Status += status => WhileCurrent(engine, () => SetStatus(status));
    engine.Transcript += (text, isUser) => WhileCurrent(engine, () => _captions.Show(text, isUser));
    engine.Level += (level, isUser) => WhileCurrent(engine, () => _glow.Follow(level, isUser));
    engine.Ended += reason => WhileCurrent(engine, () => Fail(engine, reason));

    SetStatus(LiveStatus.Connecting);
    _border.Cover(monitor);
    UpdateShareButton();
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

  /// <summary>A session died: keep the pill up with the reason, so the failure shows.</summary>
  private void Fail(ILiveEngine engine, string reason) {
    if (_conversation != engine) {
      return;
    }
    Log.Write($"ended: {reason}");
    Detach();
    SetStatus("Gemini Live stopped", detail: reason);
    _captions.AddNote(reason);
    _ = engine.DisposeAsync().AsTask();
  }

  private async Task EndAsync() {
    ILiveEngine? engine = _conversation;
    Detach();
    Leave();
    if (engine is not null) {
      await engine.DisposeAsync();
    }
  }

  /// <summary>Lets go of the session: no more events, no share border, glow at rest.</summary>
  private void Detach() {
    _conversation = null;
    _border.Hide();
    _glow.Rest();
  }

  // ---- placement: docked bottom-right above the taskbar, like Googlebook ----

  private void ShowOn(MonitorInfo monitor) {
    _dockedOn = monitor;
    KeyPanel.Visibility = Visibility.Collapsed;
    ConnectPanel.Visibility = Visibility.Collapsed;
    UpdateCard();
    bool arriving = !IsVisible || _leaving;
    _leaving = false;
    Show();
    UpdateLayout();
    Dock();
    if (arriving) {
      Motion.Enter(Root, rise: _pillRise, scaleFrom: _pillScaleFrom);
    }
  }

  /// <summary>Plays the pill's exit, then hides it, unless it is shown again meanwhile.</summary>
  private void Leave() {
    _leaving = true;
    Motion.Exit(Root, drop: _pillSink, scaleTo: _pillScaleFrom, completed: () => {
      if (!_leaving) {
        return;
      }
      _leaving = false;
      Hide();
    });
  }

  private void Dock() {
    Dock(ContentSize());
  }

  /// <summary>
  /// The size the window is about to have, read from its content: on first show the window's own
  /// size is still an interim one, which docked the pill far above the taskbar.
  /// </summary>
  private Size ContentSize() {
    Root.Measure(new Size(Width, double.PositiveInfinity));
    return new Size(Width, Root.DesiredSize.Height);  // DesiredSize already counts the margins
  }

  /// <summary>
  /// Keeps the pill's bottom-right corner pinned as the caption card grows upward. Takes the
  /// size the window is changing to: SizeToContent grows it from the top edge, and at that
  /// moment the HWND rect still holds the old size, which would push the pill onto the taskbar.
  /// </summary>
  private void Dock(Size size) {
    if (_dockedOn is not { } monitor || !IsVisible) {
      return;
    }
    DpiScale dpi = VisualTreeHelper.GetDpi(this);
    Overlay.PlaceBottomRight(Handle, monitor.WorkRight - _dockGap, monitor.WorkBottom - _dockGap,
                             (int)Math.Round(size.Width * dpi.DpiScaleX),
                             (int)Math.Round(size.Height * dpi.DpiScaleY));
  }

  // ---- sharing: which display Gemini sees ----

  private void UpdateShareButton() {
    bool many = Monitors.All().Count > 1;
    ShareChevron.Visibility = many ? Visibility.Visible : Visibility.Collapsed;
    ShareButton.IsHitTestVisible = many;
    ShareButton.ToolTip = many && Shared is { } shared
        ? $"Sharing {shared.Name} • click to change"
        : "Gemini sees your screen";
  }

  private void OnShare(object sender, RoutedEventArgs e) {
    IReadOnlyList<MonitorInfo> all = Monitors.All();
    if (all.Count < 2) {
      return;
    }
    ContextMenu menu = MenuAbove(ShareButton);
    DisplayPicker.Fill(menu, all, Shared, Share);
    menu.IsOpen = true;
  }

  private void Share(MonitorInfo monitor) {
    if (_conversation is null) {
      return;
    }
    _conversation.Share(monitor);
    _border.Cover(monitor);
    UpdateShareButton();
    Log.Write($"sharing {monitor.Description}");
  }

  /// <summary>Displays plugged in or out: keep sharing one that survived, and re-dock.</summary>
  private void OnDisplaysChanged() {
    IReadOnlyList<MonitorInfo> all = Monitors.All();
    Log.Write($"displays changed: {all.Count}");
    // Re-share even when the display survived: its bounds may have moved.
    if (Shared is { } shared) {
      Share(Monitors.Reconcile(all, shared));
    }
    if (_dockedOn is { } docked) {
      _dockedOn = Monitors.Reconcile(all, docked);
    }
    UpdateShareButton();
    Dock();
  }

  // ---- status and the caption card ----

  /// <summary>Crossfades to the new status while the pill is up; sets it outright if not.</summary>
  private void SetStatus(string status, string? detail = null) {
    StatusText.ToolTip = detail;
    if (status == _status) {
      return;
    }
    _status = status;
    if (!IsVisible || _leaving) {
      StatusText.Text = status;
      return;
    }
    Motion.Swap(StatusText, () => StatusText.Text = _status);
  }

  private void OnExtensionNeeded(bool needed) {
    ConnectPanel.Visibility = needed ? Visibility.Visible : Visibility.Collapsed;
    if (!needed) {
      ConnectSteps.Visibility = Visibility.Collapsed;
    }
    UpdateCard();
  }

  /// <summary>The card shows only when it has something: transcript, links, a setup step.</summary>
  private void UpdateCard() {
    bool any = _captions.HasContent
        || ConnectPanel.Visibility == Visibility.Visible
        || KeyPanel.Visibility == Visibility.Visible;
    bool appearing = any && CaptionCard.Visibility != Visibility.Visible;
    CaptionCard.Visibility = any ? Visibility.Visible : Visibility.Collapsed;
    if (appearing) {
      Motion.Enter(CaptionCard, rise: _cardRise);
    }
  }

  // ---- controls ----

  private void SetMuted(bool muted) {
    _muted = muted;
    if (_conversation is not null) {
      _conversation.Muted = muted;
    }
    string glyph = muted ? Glyphs.MicOff : Glyphs.Mic;
    bool changed = MicGlyph.Text.Length > 0 && MicGlyph.Text != glyph;
    MicButton.Tag = muted ? "muted" : null;  // App.xaml's round button crossfades on this tag
    MicGlyph.Text = glyph;
    MicButton.ToolTip = muted ? "Unmute microphone" : "Mute microphone";
    if (changed) {
      Motion.Bounce(MicGlyph);
    }
  }

  // Toggles the tracked mute state, not the engine's, so the button keeps working across a
  // reconnect or a brief gap when no engine is attached.
  private void OnMute(object sender, RoutedEventArgs e) {
    SetMuted(!_muted);
  }

  private void OnEnd(object sender, RoutedEventArgs e) {
    _ = EndAsync();
  }

  private void OnDrag(object sender, MouseButtonEventArgs e) {
    if (e.ButtonState == MouseButtonState.Pressed) {
      DragMove();
    }
  }

  private void OnLink(object sender, RequestNavigateEventArgs e) {
    Shell.Open(e.Uri.AbsoluteUri);
  }

  private void OnConnect(object sender, RoutedEventArgs e) {
    Glic.ExtensionSetup.Begin();
    ConnectSteps.Visibility = Visibility.Visible;
  }

  // ---- settings menu (gear): microphone, quit ----

  /// <summary>Every menu opens upward, rising out of the pill, which sits on the taskbar.</summary>
  private static ContextMenu MenuAbove(UIElement anchor) {
    var menu = new ContextMenu { PlacementTarget = anchor, Placement = PlacementMode.Top };
    menu.Opened += (_, _) => Motion.Enter(menu, rise: _menuRise);
    return menu;
  }

  private ContextMenu BuildSettingsMenu() {
    ContextMenu menu = MenuAbove(SettingsButton);
    menu.Opened += async (_, _) => await FillSettingsMenuAsync(menu);
    return menu;
  }

  /// <summary>
  /// Like Win+H's flyout: Windows' default, then every microphone, the current one checked.
  /// </summary>
  private async Task FillSettingsMenuAsync(ContextMenu menu) {
    menu.Items.Clear();
    menu.Items.Add(new MenuItem {
      Header = "Microphone",
      Style = (Style)FindResource("LiveMenuHeader"),
    });
    AddMicrophone(menu, "Default (Windows)", null);
    foreach ((string id, string name) in await _glic.ListMicrophonesAsync()) {
      AddMicrophone(menu, name, id);
    }
    // Camera share rides the Google engine's frame pull (Gemini sees it as its viewport); the
    // API-key engine pushes the screen itself, so the toggle only applies there.
    if (_settings.Engine == EngineKind.Google) {
      menu.Items.Add(new Separator());
      menu.Items.Add(new MenuItem {
        Header = "Share",
        Style = (Style)FindResource("LiveMenuHeader"),
      });
      var camera = new MenuItem {
        Header = "Camera instead of screen",
        IsCheckable = true,
        IsChecked = _glic.UseCamera,
      };
      camera.Click += async (_, _) => {
        if (!await _glic.UseCameraAsync(camera.IsChecked)) {
          camera.IsChecked = false;  // camera wouldn't open; stay on the screen
        }
      };
      menu.Items.Add(camera);
    }

    menu.Items.Add(new Separator());
    var quit = new MenuItem { Header = "Quit Gemini Live" };
    quit.Click += (_, _) => {
      _ = EndAsync();
      Application.Current.Shutdown();
    };
    menu.Items.Add(quit);
  }

  private void AddMicrophone(ContextMenu menu, string name, string? id) {
    var item = new MenuItem {
      Header = name,
      IsCheckable = true,
      IsChecked = _settings.MicrophoneId == id,
    };
    item.Click += (_, _) => {
      _settings.MicrophoneId = id;
      _settings.Save();
      _glic.SetMicrophone(id);
      Log.Write($"microphone -> {name}");
    };
    menu.Items.Add(item);
  }

  private void OnSettings(object sender, RoutedEventArgs e) {
    SettingsButton.ContextMenu.IsOpen = true;
  }

  // ---- first-run API key ----

  private void AskForKey() {
    SetStatus("Setup: Gemini needs an API key");
    KeyPanel.Visibility = Visibility.Visible;
    UpdateCard();
    // Typing needs focus, so drop the no-activate style just for this.
    Overlay.SetFocusable(Handle, true);
    Activate();
    KeyBox.Focus();
  }

  private void OnKeyBoxKeyDown(object sender, KeyEventArgs e) {
    if (e.Key != Key.Enter || KeyBox.Password.Trim().Length == 0) {
      return;
    }
    _settings.SetApiKey(KeyBox.Password);
    KeyBox.Clear();
    KeyPanel.Visibility = Visibility.Collapsed;
    UpdateCard();
    Overlay.SetFocusable(Handle, false);
    _ = StartAsync(_pendingMonitor ?? Monitors.Active());
  }
}
