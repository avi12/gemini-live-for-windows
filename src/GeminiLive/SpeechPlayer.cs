using System.Text.RegularExpressions;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;

namespace GeminiLive;

/// <summary>
/// Reads a text answer aloud. When Live can't reach a Google app (Calendar, Keep, Tasks, Gmail) we
/// fall back to a text turn, and the PC lights we switch through Google Home ourselves; the answer
/// either hands back is shown in the caption card, and this speaks it. Gemini's own cloud voice
/// can't be reproduced offline, so we use the nicest voice Windows ships: WinRT's
/// <see cref="SpeechSynthesizer"/> exposes the OneCore / "Natural" voices (far better than the old
/// System.Speech ones).
///
/// Playback is WinRT's <see cref="MediaPlayer"/>, which runs on Media Foundation. WPF's own
/// MediaPlayer needs the legacy Windows Media Player, which current Windows 11 builds no longer
/// ship - there it fails every time, and its Stop() stalls the UI thread mid-animation. The WinRT
/// player has no thread affinity and plays the synthesized stream directly, with no temp file.
/// </summary>
public sealed partial class SpeechPlayer : IDisposable {
  private const string _english = "en-US";
  private const string _hebrew = "he-IL";

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
    VoiceInformation? voice = VoiceFor(text);
    if (voice is null) {
      // Better silent than an English voice spelling out Hebrew; the card still shows the answer.
      Log.Write("SpeechPlayer: no voice installed for the answer's language; showing it only");
      return;
    }

    try {
      SpeechSynthesizer synthesizer = Synthesizer();
      synthesizer.Voice = voice;
      SpeechSynthesisStream stream = await synthesizer.SynthesizeTextToStreamAsync(text);
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

  /// <summary>The lazily built synthesizer; each answer sets its voice (<see cref="VoiceFor"/>).</summary>
  private SpeechSynthesizer Synthesizer() {
    return _synthesizer ??= new SpeechSynthesizer();
  }

  /// <summary>
  /// The single place voice selection lives: a Hebrew voice for an answer in Hebrew (null when
  /// none is installed), otherwise English.
  /// </summary>
  private static VoiceInformation? VoiceFor(string text) {
    return HebrewLetter().IsMatch(text)
        ? PickVoice(_hebrew)
        : PickVoice(_english) ?? SpeechSynthesizer.DefaultVoice;
  }

  /// <summary>
  /// The nicest installed voice for <paramref name="language"/>: natural/online-style female first,
  /// then any natural one, any female one, any at all. "Natural"/"Online" names mark the neural
  /// voices, which sound closest to Gemini.
  /// </summary>
  private static VoiceInformation? PickVoice(string language) {
    var voices = SpeechSynthesizer.AllVoices
        .Where(voice => voice.Language.StartsWith(language, StringComparison.OrdinalIgnoreCase))
        .ToList();
    bool Female(VoiceInformation voice) => voice.Gender == VoiceGender.Female;
    bool Natural(VoiceInformation voice) =>
        voice.DisplayName.Contains("Natural", StringComparison.OrdinalIgnoreCase)
        || voice.DisplayName.Contains("Online", StringComparison.OrdinalIgnoreCase);

    return voices.FirstOrDefault(voice => Female(voice) && Natural(voice))
        ?? voices.FirstOrDefault(Natural)
        ?? voices.FirstOrDefault(Female)
        ?? voices.FirstOrDefault();
  }

  [GeneratedRegex(@"\p{IsHebrew}")]
  private static partial Regex HebrewLetter();
}
