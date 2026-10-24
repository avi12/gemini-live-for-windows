using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;

namespace GeminiLive;

/// <summary>
/// Reads a text answer aloud. Gemini Live falls back to a text turn when it can't reach a Google
/// app (Calendar, Keep, Tasks, Gmail, Home); the answer it hands back is shown in the caption card,
/// and this speaks it. Gemini's own cloud voice can't be reproduced offline, so we use the nicest
/// voice Windows ships: WinRT's <see cref="SpeechSynthesizer"/> exposes the OneCore / "Natural"
/// voices (far better than the old System.Speech ones).
///
/// Playback is WinRT's <see cref="MediaPlayer"/>, which runs on Media Foundation. WPF's own
/// MediaPlayer needs the legacy Windows Media Player, which current Windows 11 builds no longer
/// ship - there it fails every time, and its Stop() stalls the UI thread mid-animation. The WinRT
/// player has no thread affinity and plays the synthesized stream directly, with no temp file.
/// </summary>
public sealed class SpeechPlayer : IDisposable {
  private readonly MediaPlayer _player = new() { AudioCategory = MediaPlayerAudioCategory.Speech };

  // The one synthesizer, created lazily with its voice chosen once (see PickVoice).
  private SpeechSynthesizer? _synthesizer;

  // Bumped by every Speak and Stop, so a synthesis that finishes after it was superseded is
  // dropped instead of starting to talk.
  private int _generation;

  public SpeechPlayer() {
    _player.MediaFailed += (_, e) => Log.Write($"SpeechPlayer: playback failed: {e.ErrorMessage}");
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

    Stop();  // a new answer supersedes whatever was speaking
    int generation = _generation;
    try {
      SpeechSynthesisStream stream = await Synthesizer().SynthesizeTextToStreamAsync(text);
      if (generation != _generation) {
        stream.Dispose();
        return;  // stopped or superseded while synthesizing
      }

      _player.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
      _player.Play();
    } catch (Exception e) {
      Log.Write($"SpeechPlayer.SpeakAsync: {e.Message}");
    }
  }

  /// <summary>Stops any current playback. Cheap when nothing is playing; safe from any thread.</summary>
  public void Stop() {
    Interlocked.Increment(ref _generation);

    if (_player.Source is null) {
      return;
    }

    (_player.Source as IDisposable)?.Dispose();
    _player.Source = null;
  }

  public void Dispose() {
    Stop();
    _player.Dispose();
    _synthesizer?.Dispose();
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
    bool EnUs(VoiceInformation voice) =>
        voice.Language.StartsWith("en-US", StringComparison.OrdinalIgnoreCase);
    bool Female(VoiceInformation voice) => voice.Gender == VoiceGender.Female;
    bool Natural(VoiceInformation voice) =>
        voice.DisplayName.Contains("Natural", StringComparison.OrdinalIgnoreCase)
        || voice.DisplayName.Contains("Online", StringComparison.OrdinalIgnoreCase);

    return voices.FirstOrDefault(voice => EnUs(voice) && Female(voice) && Natural(voice))
        ?? voices.FirstOrDefault(voice => EnUs(voice) && Natural(voice))
        ?? voices.FirstOrDefault(voice => EnUs(voice) && Female(voice))
        ?? voices.FirstOrDefault(EnUs)
        ?? SpeechSynthesizer.DefaultVoice;
  }
}
