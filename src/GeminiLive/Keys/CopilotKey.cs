using System.IO.Pipes;
using System.Windows.Interop;
using Windows.ApplicationModel.Activation;
// Windows' activation API, not this app's own single-instance AppInstance.
using WindowsAppInstance = Windows.ApplicationModel.AppInstance;

namespace GeminiLive;

/// <summary>
/// What the Copilot key / Win+C did. Values are the MessageWParam numbers and the names are the
/// ?state= values declared on the copilotkeyprovider extension in package\AppxManifest.xml -
/// keep the two in step.
/// </summary>
public enum KeyTrigger {
  Tap = 0,
  HoldStart = 1,
  HoldStop = 2,
}

/// <summary>
/// Both ways Windows tells us about the key: URI activation (cold start, or a second process when
/// we are already running) and the "fast path" window message delivered to the running window.
/// </summary>
public static class CopilotKey {
  private const string _scheme = "geminilive-key";
  private const int _wmCopilot = Native.WM_APP + 1;
  private const string _pipeName = "GeminiLive.Activate";
  private const int _forwardTimeoutMs = 150;
  private static readonly Guid _fastPathFmtId = new("38652BCA-4329-4E74-86F9-39CF29345EEA");

  /// <summary>
  /// Reads the trigger from how this process was started; null for a plain launch.
  /// </summary>
  public static KeyTrigger? FromActivation(string[] args) {
    Uri? uri = PackagedActivationUri()
        ?? args.Select(arg => Uri.TryCreate(arg, UriKind.Absolute, out Uri? parsed) ? parsed : null)
               .FirstOrDefault(parsed => parsed?.Scheme == _scheme);
    if (uri is null) {
      return null;
    }

    string? state = System.Web.HttpUtility.ParseQueryString(uri.Query)["state"];
    return Enum.TryParse(state, ignoreCase: true, out KeyTrigger t) ? t : KeyTrigger.Tap;
  }

  /// <summary>
  /// Opts the window into fast-path delivery and routes the message to
  /// <paramref name="onTrigger"/>.
  /// </summary>
  public static void RegisterFastPath(IntPtr hwnd, Action<KeyTrigger> onTrigger) {
    if (!TrySetFastPathProperty(hwnd)) {
      Log.Write("fast path: no property store for window");
    }

    HwndSource.FromHwnd(hwnd).AddHook(
        (IntPtr _, int msg, IntPtr wParam, IntPtr _, ref bool handled) => {
          if (msg == _wmCopilot && Enum.IsDefined(typeof(KeyTrigger), TriggerOf(wParam))) {
            handled = true;
            onTrigger((KeyTrigger)TriggerOf(wParam));
          }

          return IntPtr.Zero;
        });
  }

  // The message carries a small enum value; read it without the overflow check CA2020 warns about.
  private static int TriggerOf(IntPtr wParam) {
    return unchecked((int)wParam.ToInt64());
  }

  // ---- single instance: a second process hands its trigger to the first and exits ----

  public static bool TryForwardToRunningInstance(KeyTrigger? trigger) {
    try {
      using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.Out);
      pipe.Connect(_forwardTimeoutMs);
      using var writer = new StreamWriter(pipe);
      writer.Write((trigger ?? KeyTrigger.Tap).ToString());
      return true;
    } catch {
      return false;
    }
  }

  public static void ListenForForwardedTriggers(Action<KeyTrigger> onTrigger) {
    _ = Task.Run(async () => {
      while (true) {
        await AcceptForwardedTriggerAsync(onTrigger);
      }
    });
  }

  /// <summary>
  /// True when Windows started us at sign-in (the startup task in package\AppxManifest.xml): the app
  /// only comes up to hold the Circle to Search key, so no conversation starts.
  /// </summary>
  public static bool StartedAtSignIn() {
    return PackagedActivation()?.Kind == ActivationKind.StartupTask;
  }

  /// <summary>The activation URI Windows gave a packaged launch, if any.</summary>
  private static Uri? PackagedActivationUri() {
    return PackagedActivation() is ProtocolActivatedEventArgs protocol ? protocol.Uri : null;
  }

  /// <summary>How Windows started this packaged process; null for an unpackaged dev run.</summary>
  private static IActivatedEventArgs? PackagedActivation() {
    try {
      return WindowsAppInstance.GetActivatedEventArgs();
    } catch {
      return null;  // unpackaged dev run: no activation args
    }
  }

  private static bool TrySetFastPathProperty(IntPtr hwnd) {
    Guid iid = typeof(Native.IPropertyStore).GUID;
    if (Native.SHGetPropertyStoreForWindow(hwnd, ref iid, out Native.IPropertyStore store) != 0) {
      return false;
    }

    var key = new Native.PROPERTYKEY { fmtid = _fastPathFmtId, pid = 2 };
    var value = new Native.PROPVARIANT { variantType = Native.VT_UINT, uintVal = _wmCopilot };
    store.SetValue(ref key, ref value);
    store.Commit();
    return true;
  }

  private static async Task AcceptForwardedTriggerAsync(Action<KeyTrigger> onTrigger) {
    try {
      using var pipe = new NamedPipeServerStream(
          _pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte,
          PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
      await pipe.WaitForConnectionAsync();
      string text = await new StreamReader(pipe).ReadToEndAsync();
      if (Enum.TryParse(text, out KeyTrigger t)) {
        onTrigger(t);
      }
    } catch (Exception e) {
      Log.Write($"activation pipe: {e.Message}");
      await Task.Delay(500);
    }
  }
}
