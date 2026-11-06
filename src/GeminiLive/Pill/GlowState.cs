namespace GeminiLive;

/// <summary>
/// What Gemini's glow under the pill should be doing, as data: it breathes while Gemini's page owns
/// the audio, follows voice levels otherwise, and rests when the session is over. How it looks is
/// the window's.
/// </summary>
public sealed class GlowState {
  private const float _quietLevel = 0.02f;
  private const double _levelSteps = 100;  // levels are sent to the hundredth, so a burst coalesces

  public PillGlow Current { get; private set; } = new(GlowMode.Rest, 0, false);

  /// <summary>Gemini's page owns the audio, so there are no levels: breathe instead.</summary>
  public void Breathe() {
    Current = new PillGlow(GlowMode.Breathe, 0, false);
  }

  /// <summary>Follows a voice peak (0..1) from either side of the conversation.</summary>
  public void Follow(float level, bool isUser) {
    if (isUser && level < _quietLevel) {
      return;  // let Gemini's voice own the glow while the user is quiet
    }

    double steady = Math.Round(Math.Clamp(level, 0, 1) * _levelSteps) / _levelSteps;
    Current = new PillGlow(GlowMode.Level, steady, isUser);
  }

  /// <summary>The session ended.</summary>
  public void Rest() {
    Current = new PillGlow(GlowMode.Rest, 0, false);
  }
}
