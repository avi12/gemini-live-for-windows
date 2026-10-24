using System.Windows;

namespace GeminiLive;

/// <summary>
/// Stays resident after the first launch so the next Win+C is instant (fast path). The first
/// process owns the mutex; any later process just forwards its trigger and exits.
/// </summary>
// The mutex lives as long as the process: releasing it early would let a second instance start.
[System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1001", Justification = "Held for the process lifetime")]
public partial class App : Application {
  private const string _instanceName = @"Local\GeminiLive.SingleInstance";
  private const int _forwardAttempts = 10;

  // Never read, only held: the field keeps the mutex from being collected (and released).
  [System.Diagnostics.CodeAnalysis.SuppressMessage("CodeQuality", "IDE0052",
                                                   Justification = "Held for the process lifetime")]
  private Mutex? _instance;

  protected override void OnStartup(StartupEventArgs e) {
    base.OnStartup(e);
    KeyTrigger? trigger = CopilotKey.FromActivation(e.Args);
    Log.Write($"launch trigger={trigger?.ToString() ?? "none"} "
              + $"args=[{string.Join(' ', e.Args)}]");

    _instance = new Mutex(true, _instanceName, out bool first);

    if (!first) {
      ForwardAndExit(trigger);
      return;
    }

    Theme.Follow();
    DispatcherUnhandledException += (_, args) => {
      Log.Write($"unhandled: {args.Exception}");
      args.Handled = true;
    };

    // Load Gemini now, so pressing Win+C later doesn't wait for a page load.
    Glic.ExtensionSetup.RefreshInstalled();
    var link = new Glic.SessionLink();
    link.Start();
    var glic = new Glic.GlicHost(link);
    _ = glic.WarmUpAsync().ContinueWith(t => Log.Write($"warm-up failed: {t.Exception}"),
                                        TaskContinuationOptions.OnlyOnFaulted);
    var home = new Glic.HomeHost(link);
    _ = home.WarmUpAsync().ContinueWith(t => Log.Write($"home warm-up failed: {t.Exception}"),
                                        TaskContinuationOptions.OnlyOnFaulted);
    var pill = new MainWindow(glic, home);
    CopilotKey.RegisterFastPath(pill.Handle, pill.OnTrigger);
    CopilotKey.ListenForForwardedTriggers(t => Dispatcher.Invoke(() => pill.OnTrigger(t)));
    pill.OnTrigger(trigger ?? KeyTrigger.Tap);
  }

  /// <summary>Another instance is running: hand it our trigger and leave.</summary>
  private void ForwardAndExit(KeyTrigger? trigger) {
    for (int i = 0; i < _forwardAttempts; i++) {
      if (CopilotKey.TryForwardToRunningInstance(trigger)) {
        break;
      }

      Thread.Sleep(100);
    }
    Shutdown();
  }
}
