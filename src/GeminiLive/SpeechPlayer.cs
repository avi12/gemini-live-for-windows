using System.Windows.Threading;
using Windows.Media.SpeechSynthesis;
using Windows.Storage.Streams;

// WPF's own MediaPlayer, not WinRT's Windows.Media.Playback.MediaPlayer - the two collide by name,
// so we alias the one we mean.
using WpfMediaPlayer = System.Windows.Media.MediaPlayer;

namespace GeminiLive;

/// <summary>
/// Reads a text answer aloud. Gemini Live falls back to a text turn when it can't reach a Google
/// app (Calendar, Keep, Tasks, Gmail, Home); the answer it hands back is shown in the caption card,
/// and this speaks it. Gemini's own cloud voice can't be reproduced offline, so we use the nicest
/// voice Windows ships: WinRT's <see cref="SpeechSynthesizer"/> exposes the OneCore / "Natural"
/// voices (far better than the old System.Speech ones) and renders to a WAV stream, which a WPF
/// <see cref="WpfMediaPlayer"/> plays back.
///
/// Threading: <see cref="WpfMediaPlayer"/> is thread-affine - it must be created and driven on a
/// thread with a <see cref="Dispatcher"/> (the WPF UI thread). Construct this on that thread; it
/// captures the dispatcher and marshals every player call back to it, so both <see cref="SpeakAsync"/>
/// and <see cref="Stop"/> are safe to call straight from the WPF dispatcher thread (or any thread).
/// </summary>
public sealed class SpeechPlayer {
  private readonly Dispatcher _dispatcher;
  private readonly WpfMediaPlayer _player;

  // The one synthesizer, created lazily with its voice chosen once (see PickVoice). Synthesis can
  // run on any thread, so it is not dispatcher-bound; only the player is.
  private SpeechSynthesizer? _synthesizer;

  // The temp WAV currently loaded in the player, so we can delete it once playback ends or stops.
  private string? _currentFile;

  public SpeechPlayer() {
    // Constructed on the WPF UI thread, so this is the UI dispatcher and the player is born on it.
    _dispatcher = Dispatcher.CurrentDispatcher;
    _player = new WpfMediaPlayer();
    _player.MediaEnded += (_, _) => DropCurrentFile();
    _player.MediaFailed += (_, e) => {
      Log.Write($"SpeechPlayer: playback failed: {e.ErrorException?.Message}");
      DropCurrentFile();
    };
  }

  /// <summary>
  /// Synthesizes <paramref name="text"/> and plays it, cutting off anything already playing. The
  /// returned task completes once playback has been started (not when the audio finishes). Empty or
  /// whitespace text is a no-op, and any failure is logged rather than thrown.
  /// </summary>
  public async Task SpeakAsync(string text) {
    if (string.IsNullOrWhiteSpace(text)) {
      return;  // nothing to say
    }
    try {
      Stop();  // a new answer supersedes whatever was speaking
      SpeechSynthesizer synthesizer = Synthesizer();
      using SpeechSynthesisStream stream = await synthesizer.SynthesizeTextToStreamAsync(text);
      string file = await WriteTempWavAsync(stream);
      // MediaPlayer is thread-affine: open and play on the dispatcher that owns it.
      await _dispatcher.InvokeAsync(() => StartPlayback(file));
    } catch (Exception e) {
      Log.Write($"SpeechPlayer.SpeakAsync: {e.Message}");
    }
  }

  /// <summary>Stops any current playback and discards its audio. Safe to call from any thread.</summary>
  public void Stop() {
    if (_dispatcher.CheckAccess()) {
      StopCore();
    } else {
      _dispatcher.Invoke(StopCore);
    }
  }

  /// <summary>The lazily built synthesizer, with the chosen voice applied exactly once.</summary>
  private SpeechSynthesizer Synthesizer() {
    if (_synthesizer is null) {
      _synthesizer = new SpeechSynthesizer();
      VoiceInformation? voice = PickVoice();
      if (voice is not null) {
        _synthesizer.Voice = voice;
      }
      Log.Write($"SpeechPlayer: voice '{_synthesizer.Voice?.DisplayName}'");
    }
    return _synthesizer;
  }

  /// <summary>
  /// The single place voice selection lives. Prefers a natural/online-style en-US female voice,
  /// then relaxes: natural en-US, any en-US female, any en-US, and finally the system default.
  /// "Natural"/"Online" names mark the neural voices, which sound closest to Gemini.
  /// </summary>
  private static VoiceInformation? PickVoice() {
    var voices = SpeechSynthesizer.AllVoices;
    bool EnUs(VoiceInformation v) =>
        v.Language.StartsWith("en-US", StringComparison.OrdinalIgnoreCase);
    bool Female(VoiceInformation v) => v.Gender == VoiceGender.Female;
    bool Natural(VoiceInformation v) =>
        v.DisplayName.Contains("Natural", StringComparison.OrdinalIgnoreCase)
        || v.DisplayName.Contains("Online", StringComparison.OrdinalIgnoreCase);

    return voices.FirstOrDefault(v => EnUs(v) && Female(v) && Natural(v))
        ?? voices.FirstOrDefault(v => EnUs(v) && Natural(v))
        ?? voices.FirstOrDefault(v => EnUs(v) && Female(v))
        ?? voices.FirstOrDefault(EnUs)
        ?? SpeechSynthesizer.DefaultVoice;
  }

  // ---- player, all on the dispatcher thread ----

  private void StartPlayback(string file) {
    _currentFile = file;
    _player.Open(new Uri(file, UriKind.Absolute));
    _player.Play();
  }

  private void StopCore() {
    try {
      _player.Stop();
      _player.Close();  // releases the WAV so we can delete it
    } catch (Exception e) {
      Log.Write($"SpeechPlayer.Stop: {e.Message}");
    }
    DropCurrentFile();
  }

  private void DropCurrentFile() {
    if (_currentFile is null) {
      return;
    }
    try {
      File.Delete(_currentFile);
    } catch {
      // A still-open handle can briefly hold the file; it is only a temp, so let the OS reap it.
    }
    _currentFile = null;
  }

  /// <summary>Drains the synthesized WAV stream to a temp file the player can open by URI.</summary>
  private static async Task<string> WriteTempWavAsync(SpeechSynthesisStream stream) {
    using var reader = new DataReader(stream);
    await reader.LoadAsync((uint)stream.Size);
    var bytes = new byte[(int)stream.Size];
    reader.ReadBytes(bytes);

    string file = Path.Combine(Path.GetTempPath(), $"GeminiLive-speech-{Guid.NewGuid():N}.wav");
    await File.WriteAllBytesAsync(file, bytes);
    return file;
  }
}
