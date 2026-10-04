using System.Windows;

namespace GeminiLive;

/// <summary>
/// Stays resident after the first launch so the next Win+C is instant (fast path). The first
/// process owns the mutex; any later process just forwards its trigger and exits.
/// </summary>
public partial class App : Application
{
    Mutex? _instance;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var trigger = CopilotKey.FromActivation(e.Args);
        Log.Write($"launch trigger={trigger?.ToString() ?? "none"} args=[{string.Join(' ', e.Args)}]");

        _instance = new Mutex(true, @"Local\GeminiLive.SingleInstance", out var first);
        if (!first)
        {
            for (int i = 0; i < 10 && !CopilotKey.TryForwardToRunningInstance(trigger); i++) Thread.Sleep(100);
            Shutdown();
            return;
        }

        Theme.Follow();
        DispatcherUnhandledException += (_, ex) => { Log.Write($"unhandled: {ex.Exception}"); ex.Handled = true; };

        // Load Gemini now, so pressing Win+C later doesn't wait for a page load.
        var link = new Glic.SessionLink();
        link.Start();
        var glic = new Glic.GlicHost(link);
        _ = glic.WarmUpAsync().ContinueWith(t => Log.Write($"warm-up failed: {t.Exception}"), TaskContinuationOptions.OnlyOnFaulted);
        var pill = new MainWindow(glic);
        CopilotKey.RegisterFastPath(pill.Handle, pill.OnTrigger);
        CopilotKey.ListenForForwardedTriggers(t => Dispatcher.Invoke(() => pill.OnTrigger(t)));
        pill.OnTrigger(trigger ?? KeyTrigger.Tap);
    }
}
