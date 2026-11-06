namespace GeminiLive;

// What the pill window asks for. Each action is checked here against the state it acts on; one that
// can't be done is refused with a message, which the window gets as the answer's error.
public sealed partial class PillController {
  private const string _noMicrophone = "Default (Windows)";
  private const string _noUpdate = "There is no update to install";
  private const string _unpackaged = "Updates need the installed app";
  private const string _needsGoogleEngine = "Camera sharing needs the Gemini subscription engine";

  /// <summary>Does the action on the UI thread. Slow work carries on in the background.</summary>
  private Task Apply(PillAction action) {
    switch (action) {
      case PillAction.Mute:
        SetMuted(!_muted);  // the tracked state, not the engine's, so it works across a reconnect
        break;
      case PillAction.Finish:
        _ = EndAsync();
        break;
      case PillAction.Share share:
        ShareDisplay(share.DisplayId);
        break;
      case PillAction.SetMicrophone microphone:
        SetMicrophone(microphone.MicrophoneId);
        break;
      case PillAction.RefreshMicrophones:
        _ = RefreshMicrophonesAsync();
        break;
      case PillAction.SetCamera camera:
        _ = SetCameraAsync(camera.IsOn);
        break;
      case PillAction.SetEngine engine:
        _ = SwitchEngineAsync(engine.Engine);
        break;
      case PillAction.AskForKey:
        AskForKey();
        break;
      case PillAction.SubmitKey key:
        SubmitKey(key.Key);
        break;
      case PillAction.CancelKey:
        CancelKey();
        break;
      case PillAction.ConnectExtension:
        ConnectExtension();
        break;
      case PillAction.OpenLink link:
        Shell.Open(link.Uri.AbsoluteUri);
        break;
      case PillAction.Update:
        InstallUpdate();
        break;
      case PillAction.CheckForUpdates:
        CheckForUpdates();
        break;
      case PillAction.SetAutoUpdate autoUpdate:
        UpdateMenu.SetAutoCheck(_updates, _settings, autoUpdate.IsOn);
        break;
      case PillAction.Quit:
        _ = EndAsync();
        System.Windows.Application.Current.Shutdown();
        break;
      case PillAction.SetFocusable focusable:
        SetFocusable(focusable.IsFocusable);
        break;
      case PillAction.MoveBy move:
        MoveBy(move);
        break;
    }

    Changed();
    return Task.CompletedTask;
  }

  private void ShareDisplay(string displayId) {
    MonitorInfo monitor = Monitors.All().FirstOrDefault(display => display.DeviceName == displayId)
        ?? throw new InvalidOperationException($"There is no display '{displayId}'");
    Share(monitor);
  }

  private void SetMicrophone(string? id) {
    string name = _microphones.FirstOrDefault(microphone => microphone.Id == id)?.Name ?? _noMicrophone;
    if (id is not null && name == _noMicrophone) {
      throw new InvalidOperationException($"There is no microphone '{id}'");
    }

    _settings.MicrophoneId = id;
    _settings.Save();
    _glic.SetMicrophone(id);
    Log.Write($"microphone -> {name}");
  }

  /// <summary>
  /// Camera share rides the Google engine's frame pull (Gemini sees it as its viewport); the API-key
  /// engine pushes the screen itself, so the toggle only applies there. A camera that won't open
  /// leaves the screen as the source, which the view then says.
  /// </summary>
  private async Task SetCameraAsync(bool isOn) {
    if (_settings.Engine != EngineKind.Google) {
      Log.Write(_needsGoogleEngine);
      return;
    }

    await _glic.View.UseCameraAsync(isOn);
    Changed();
  }

  private void SubmitKey(string key) {
    _settings.SetApiKey(key);
    HideKeyPanel();
    _ = RestartAsync();
  }

  /// <summary>
  /// Backs out of the prompt: with no key to fall back on, back to the subscription; otherwise
  /// the current key stays.
  /// </summary>
  private void CancelKey() {
    HideKeyPanel();

    if (!_settings.HasApiKey) {
      _ = SwitchEngineAsync(EngineKind.Google);
    }
  }

  private void ConnectExtension() {
    Glic.ExtensionSetup.Begin();
    _isExtensionStepsShown = true;
  }

  private void InstallUpdate() {
    if (!_updates.Install()) {
      throw new InvalidOperationException(_noUpdate);
    }

    _captions.AddNote(UpdateMenu.InstallerNote);
  }

  private void CheckForUpdates() {
    if (UpdateChecker.Installed is null) {
      throw new InvalidOperationException(_unpackaged);
    }

    _ = SayUpdateCheckAsync();
  }

  private async Task SayUpdateCheckAsync() {
    _captions.AddNote(await UpdateMenu.CheckAsync(_updates));
    Changed();
  }

  /// <summary>The window asks to be dragged: it can't move itself, and the host knows where it is.</summary>
  private void MoveBy(PillAction.MoveBy move) {
    IntPtr hwnd = _host.WindowHandle;
    if (hwnd == IntPtr.Zero || !Native.GetWindowRect(hwnd, out Native.RECT rect)) {
      throw new InvalidOperationException("The pill's window isn't up yet");
    }

    Overlay.Place(hwnd, rect.Left + (int)Math.Round(move.DeltaX), rect.Top + (int)Math.Round(move.DeltaY));
  }
}
