namespace GeminiLive.Glic;

/// <summary>
/// The Google-account engine: one Live session on the long-lived <see cref="GlicHost"/>. Gemini's
/// own client does the audio, so there are no levels to show; captions arrive as whole utterances.
/// </summary>
public sealed class GlicConversation : ILiveEngine
{
    readonly GlicHost _host;
    bool _muted;

    public event Action<string>? Status;
    public event Action<string, bool>? Transcript;
    public event Action<float, bool>? Level { add { } remove { } }
    public event Action<string>? Ended;

    public GlicConversation(GlicHost host, MonitorInfo monitor)
    {
        _host = host;
        host.Monitor = monitor;
        host.State += OnState;
        host.Caption += OnCaption;
        host.Failed += OnFailed;
        host.Notice += OnNotice;
    }

    public MonitorInfo Monitor => _host.Monitor;

    public bool Muted
    {
        get => _muted;
        set { _muted = value; _host.SetMuted(value); }
    }

    public void Share(MonitorInfo monitor) => _host.Monitor = monitor;

    // No timeout here: the page reports its own start failure, and waiting for the browser's
    // Google session (extension not yet connected, user signing in) can legitimately take a while.
    public Task StartAsync() => _host.StartAsync();

    void OnState(string state) => Status?.Invoke(state switch
    {
        "listening" => "Listening",
        "paused" => "Paused - press Win+C to resume",
        _ => "Idle",
    });

    void OnCaption(string text, bool isUser, int _) => Transcript?.Invoke(text, isUser);
    void OnFailed(string message) => Ended?.Invoke(message);
    void OnNotice(string notice) => Status?.Invoke(notice);

    public ValueTask DisposeAsync()
    {
        _host.State -= OnState;
        _host.Caption -= OnCaption;
        _host.Failed -= OnFailed;
        _host.Notice -= OnNotice;
        _host.Stop();
        return ValueTask.CompletedTask;
    }
}
