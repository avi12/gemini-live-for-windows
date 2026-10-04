using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace GeminiLive;

/// <summary>
/// The flyout, styled after Windows' own voice typing panel (TextInputHost): settings and close
/// on top, a big accent mic in the middle, status and live captions under it, display picker last.
/// </summary>
public partial class MainWindow : Window
{
    readonly Settings _settings = Settings.Load();
    readonly ShareBorder _border = new();
    readonly Glic.GlicHost _glic;
    ILiveEngine? _conversation;
    MonitorInfo? _pendingMonitor;

    public IntPtr Handle { get; }

    public MainWindow(Glic.GlicHost glic)
    {
        _glic = glic;
        InitializeComponent();
        Handle = Overlay.Prepare(this, clickThrough: false);
        HwndSource.FromHwnd(Handle).CompositionTarget.BackgroundColor = Colors.Transparent;
        glic.ExtensionNeeded += needed =>
        {
            ConnectPanel.Visibility = needed ? Visibility.Visible : Visibility.Collapsed;
            MonitorPicker.Visibility = needed || Monitors.All().Count < 2 ? Visibility.Collapsed : Visibility.Visible;
            if (!needed) ConnectSteps.Visibility = Visibility.Collapsed;
        };
        Theme.Acrylic(Handle);
        BuildMenu();
    }

    // ---- Copilot key ----

    public void OnTrigger(KeyTrigger trigger)
    {
        Log.Write($"trigger {trigger}");
        switch (trigger)
        {
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

    async Task StartAsync(MonitorInfo monitor)
    {
        ShowOn(monitor);
        if (_settings.Engine == EngineKind.ApiKey && !_settings.HasApiKey)
        {
            _pendingMonitor = monitor;
            AskForKey();
            return;
        }

        ILiveEngine c = _settings.Engine == EngineKind.Google
            ? new Glic.GlicConversation(_glic, monitor)
            : new Conversation(_settings, monitor);
        _conversation = c;
        c.Status += s => Dispatcher.BeginInvoke(() => { if (_conversation == c) StatusText.Text = s; });
        c.Transcript += (t, user) => Dispatcher.BeginInvoke(() => { if (_conversation == c) ShowCaption(t, user); });
        c.Level += (l, user) => Dispatcher.BeginInvoke(() => { if (_conversation == c) PulseTo(l, user); });
        c.Ended += reason => Dispatcher.BeginInvoke(() => Fail(c, reason));

        SetStatus("Connecting…", "");
        _border.Cover(monitor);
        try
        {
            await c.StartAsync();
            if (_conversation != c) return; // ended while connecting
            SetStatus("Listening…", "Go ahead, I can see your screen.");
            if (_settings.Engine == EngineKind.Google) Breathe(); // the page owns the audio; no levels to follow
            SetMuted(false);
        }
        catch (Exception e)
        {
            if (_conversation != c) return;
            Log.Write($"start failed: {e}");
            Fail(c, e.Message);
            if (e.Message.Contains("API key", StringComparison.OrdinalIgnoreCase)) AskForKey();
        }
    }

    /// <summary>A session died: keep the flyout up with the reason, so the failure is visible.</summary>
    void Fail(ILiveEngine c, string reason)
    {
        if (_conversation != c) return;
        Log.Write($"ended: {reason}");
        _conversation = null;
        _border.Hide();
        StopPulse();
        SetStatus("Gemini Live stopped", reason);
        _ = c.DisposeAsync().AsTask();
    }

    async Task EndAsync()
    {
        var c = _conversation;
        _conversation = null;
        _border.Hide();
        StopPulse();
        Hide();
        if (c is not null) await c.DisposeAsync();
    }

    // ---- display picker ----

    void ShowOn(MonitorInfo monitor)
    {
        KeyPanel.Visibility = Visibility.Collapsed;
        ConnectPanel.Visibility = Visibility.Collapsed;
        MonitorPicker.Children.Clear();
        var all = Monitors.All();
        MonitorPicker.Visibility = all.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var m in all)
        {
            var chip = new RadioButton
            {
                Style = (Style)FindResource("MonitorChip"), GroupName = "Monitors",
                Content = m.Label, ToolTip = m.Description, Tag = m,
                IsChecked = m.DeviceName == monitor.DeviceName,
            };
            chip.Checked += (_, _) => Share((MonitorInfo)chip.Tag);
            MonitorPicker.Children.Add(chip);
        }

        Show();
        UpdateLayout();
        // Bottom-centre of the display the user was working on, where voice typing sits.
        Native.GetWindowRect(Handle, out var r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        Overlay.Place(Handle, monitor.X + (monitor.Width - w) / 2, monitor.Y + monitor.Height - h - 72);
    }

    void Share(MonitorInfo monitor)
    {
        if (_conversation is null) return;
        _conversation.Share(monitor);
        _border.Cover(monitor);
        Log.Write($"sharing {monitor.Description}");
    }

    // ---- status, captions, pulse ----

    void SetStatus(string status, string caption)
    {
        StatusText.Text = status;
        Caption.Text = caption;
        Caption.Foreground = (Brush)FindResource("SecondaryTextBrush");
    }

    void ShowCaption(string text, bool isUser)
    {
        // Keep the tail of a long utterance: the newest words are the ones being spoken.
        Caption.Text = text.Length > 140 ? "…" + text[^140..] : text;
        Caption.Foreground = (Brush)FindResource(isUser ? "SecondaryTextBrush" : "TextBrush");
    }

    void PulseTo(float level, bool isUser)
    {
        if (isUser && level < 0.02f) return; // let Gemini's voice own the ring while the user is quiet
        var target = 0.7 + Math.Min(1, level * 3) * 0.3;
        AnimatePulse(new DoubleAnimation(target, TimeSpan.FromMilliseconds(90)));
    }

    void Breathe() => AnimatePulse(new DoubleAnimation(0.72, 0.95, TimeSpan.FromMilliseconds(1100))
    {
        AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase(),
    });

    void StopPulse() => AnimatePulse(null);

    void AnimatePulse(DoubleAnimation? anim)
    {
        PulseScale.BeginAnimation(ScaleTransform.ScaleXProperty, anim);
        PulseScale.BeginAnimation(ScaleTransform.ScaleYProperty, anim);
    }

    // ---- controls ----

    void SetMuted(bool muted)
    {
        if (_conversation is not null) _conversation.Muted = muted;
        MicButton.Tag = muted ? "muted" : null;
        MicButton.ToolTip = muted ? "Unmute microphone" : "Mute microphone";
        Pulse.Visibility = muted ? Visibility.Hidden : Visibility.Visible;
    }

    void OnConnect(object sender, RoutedEventArgs e)
    {
        Glic.ExtensionSetup.Begin();
        ConnectSteps.Visibility = Visibility.Visible;
    }

    void OnMute(object sender, RoutedEventArgs e) => SetMuted(!(_conversation?.Muted ?? false));
    void OnEnd(object sender, RoutedEventArgs e) => _ = EndAsync();
    void OnDrag(object sender, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); }
    void OnLink(object sender, System.Windows.Navigation.RequestNavigateEventArgs e) =>
        Process.Start(new ProcessStartInfo(e.Uri.AbsoluteUri) { UseShellExecute = true });

    // ---- settings menu (gear): engine, quit ----

    void BuildMenu()
    {
        var menu = new ContextMenu { PlacementTarget = SettingsButton };
        MenuItem Item(string header, Action click, bool? check = null)
        {
            var item = new MenuItem { Header = header, IsCheckable = check is not null };
            item.Click += (_, _) => click();
            menu.Items.Add(item);
            return item;
        }
        var google = Item("Use my Google account", () => SetEngine(EngineKind.Google), true);
        var apiKey = Item("Use a Gemini API key", () => SetEngine(EngineKind.ApiKey), true);
        menu.Opened += (_, _) => { google.IsChecked = _settings.Engine == EngineKind.Google; apiKey.IsChecked = !google.IsChecked; };
        menu.Items.Add(new Separator());
        Item("Quit Gemini Live", () => { _ = EndAsync(); Application.Current.Shutdown(); });
        SettingsButton.ContextMenu = menu;
    }

    void OnSettings(object sender, RoutedEventArgs e) => SettingsButton.ContextMenu.IsOpen = true;

    void SetEngine(EngineKind engine)
    {
        _settings.Engine = engine;
        _settings.Save();
        Log.Write($"engine -> {engine}");
        if (_conversation is { } c) _ = RestartAsync(c.Monitor);
    }

    async Task RestartAsync(MonitorInfo monitor)
    {
        await EndAsync();
        await StartAsync(monitor);
    }

    // ---- first-run API key ----

    void AskForKey()
    {
        SetStatus("Setup", "Gemini needs an API key to start.");
        MonitorPicker.Visibility = Visibility.Collapsed;
        KeyPanel.Visibility = Visibility.Visible;
        // Typing needs focus, so drop the no-activate style just for this.
        Native.SetWindowLong(Handle, Native.GWL_EXSTYLE,
            Native.GetWindowLong(Handle, Native.GWL_EXSTYLE) & ~Native.WS_EX_NOACTIVATE);
        Activate();
        Native.SetForegroundWindow(Handle);
        KeyBox.Focus();
    }

    void OnKeyBoxKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || KeyBox.Password.Trim().Length == 0) return;
        _settings.SetApiKey(KeyBox.Password);
        KeyBox.Clear();
        KeyPanel.Visibility = Visibility.Collapsed;
        Native.SetWindowLong(Handle, Native.GWL_EXSTYLE,
            Native.GetWindowLong(Handle, Native.GWL_EXSTYLE) | Native.WS_EX_NOACTIVATE);
        _ = StartAsync(_pendingMonitor ?? Monitors.Active());
    }
}
