using System.IO.Pipes;
using System.Windows.Interop;

namespace GeminiLive;

/// <summary>
/// What the Copilot key / Win+C did. Values are the MessageWParam numbers and the names are the
/// ?state= values declared on the copilotkeyprovider extension in package\AppxManifest.xml -
/// keep the two in step.
/// </summary>
public enum KeyTrigger { Tap = 0, HoldStart = 1, HoldStop = 2 }

/// <summary>
/// Both ways Windows tells us about the key: URI activation (cold start, or a second process when
/// we are already running) and the "fast path" window message delivered to the running window.
/// </summary>
public static class CopilotKey
{
    public const string Scheme = "geminilive-key";
    const int WM_COPILOT = Native.WM_APP + 1;
    static readonly Guid FastPathFmtId = new("38652BCA-4329-4E74-86F9-39CF29345EEA");
    const string PipeName = "GeminiLive.Activate";

    /// <summary>Reads the trigger from how this process was started; null for a plain launch.</summary>
    public static KeyTrigger? FromActivation(string[] args)
    {
        Uri? uri = null;
        try
        {
            if (Windows.ApplicationModel.AppInstance.GetActivatedEventArgs()
                is Windows.ApplicationModel.Activation.ProtocolActivatedEventArgs p)
                uri = p.Uri;
        }
        catch { /* unpackaged dev run: no activation args */ }

        uri ??= args.Select(a => Uri.TryCreate(a, UriKind.Absolute, out var u) ? u : null)
                    .FirstOrDefault(u => u?.Scheme == Scheme);
        if (uri is null) return null;

        var state = System.Web.HttpUtility.ParseQueryString(uri.Query)["state"];
        return Enum.TryParse<KeyTrigger>(state, ignoreCase: true, out var t) ? t : KeyTrigger.Tap;
    }

    /// <summary>Opts the window into fast-path delivery and routes the message to <paramref name="onTrigger"/>.</summary>
    public static void RegisterFastPath(IntPtr hwnd, Action<KeyTrigger> onTrigger)
    {
        var iid = typeof(Native.IPropertyStore).GUID;
        if (Native.SHGetPropertyStoreForWindow(hwnd, ref iid, out var store) == 0)
        {
            var key = new Native.PROPERTYKEY { fmtid = FastPathFmtId, pid = 2 };
            var value = new Native.PROPVARIANT { vt = Native.VT_UINT, uintVal = WM_COPILOT };
            store.SetValue(ref key, ref value);
            store.Commit();
        }
        else Log.Write("fast path: no property store for window");

        HwndSource.FromHwnd(hwnd).AddHook((IntPtr _, int msg, IntPtr wParam, IntPtr _, ref bool handled) =>
        {
            if (msg == WM_COPILOT && Enum.IsDefined(typeof(KeyTrigger), (int)wParam))
            {
                handled = true;
                onTrigger((KeyTrigger)(int)wParam);
            }
            return IntPtr.Zero;
        });
    }

    // ---- single instance: a second process hands its trigger to the first and exits ----

    public static bool TryForwardToRunningInstance(KeyTrigger? trigger)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            pipe.Connect(150);
            using var w = new StreamWriter(pipe);
            w.Write((trigger ?? KeyTrigger.Tap).ToString());
            return true;
        }
        catch { return false; }
    }

    public static void ListenForForwardedTriggers(Action<KeyTrigger> onTrigger) => Task.Run(async () =>
    {
        while (true)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.In, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();
                var text = await new StreamReader(pipe).ReadToEndAsync();
                if (Enum.TryParse<KeyTrigger>(text, out var t)) onTrigger(t);
            }
            catch (Exception e) { Log.Write($"activation pipe: {e.Message}"); await Task.Delay(500); }
        }
    });
}
