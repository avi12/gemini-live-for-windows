using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace GeminiLive;

/// <summary>
/// One JPEG still of a monitor, downscaled. Every screen frame Gemini sees comes from here.
/// </summary>
public static class ScreenGrabber {
  public sealed record Frame(byte[] Jpeg, int Width, int Height);

  /// <summary>How much detail a frame keeps.</summary>
  public enum Detail {
    /// <summary>Enough for the API engine, which bills each 768-pixel tile of a frame.</summary>
    Standard,
    /// <summary>
    /// For Gemini's web client, which misreads small text in a downscaled, compressed picture.
    /// </summary>
    Sharp,
  }

  public const string MimeType = "image/jpeg";

  private static readonly ImageCodecInfo _jpegCodec =
      ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);

  private static (int MaxEdge, long JpegQuality) Settings(Detail detail) {
    return detail == Detail.Sharp ? (2200, 85) : (1280, 70);
  }

  /// <summary>
  /// The monitor, or just <paramref name="region"/> of it (in the monitor's pixels: the part
  /// Circle to Search focused Gemini on), as one frame: a full-resolution copy, encoded at once.
  /// </summary>
  public static Frame Grab(MonitorInfo monitor, Detail detail = Detail.Standard,
                           Rectangle? region = null) {
    using Bitmap shot = Capture(monitor, region);
    return Encode(shot, new Rectangle(0, 0, shot.Width, shot.Height), detail);
  }

  /// <summary>
  /// The monitor (or <paramref name="region"/> of it) at full physical resolution, unencoded, for a
  /// caller that holds the pixels before deciding what to send - Circle to Search freezes the
  /// screen on it. The caller owns and disposes it.
  /// </summary>
  public static Bitmap Capture(MonitorInfo monitor, Rectangle? region = null) {
    Rectangle area = region ?? new Rectangle(0, 0, monitor.Width, monitor.Height);
    var shot = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
    using (Graphics graphics = Graphics.FromImage(shot)) {
      graphics.CopyFromScreen(monitor.X + area.X, monitor.Y + area.Y, 0, 0, area.Size,
                              CopyPixelOperation.SourceCopy);
    }

    return shot;
  }

  /// <summary>
  /// Crops <paramref name="region"/> (in <paramref name="source"/>'s pixels) out of a capture,
  /// downscales it to the detail's longest edge and JPEG-encodes it: the one encoder every frame
  /// goes through, whole screen or circled part.
  /// </summary>
  public static Frame Encode(Bitmap source, Rectangle region, Detail detail) {
    (int maxEdge, long jpegQuality) = Settings(detail);
    double scale = Math.Min(1.0, (double)maxEdge / Math.Max(region.Width, region.Height));
    using var small = new Bitmap(Math.Max(1, (int)(region.Width * scale)),
                                 Math.Max(1, (int)(region.Height * scale)),
                                 PixelFormat.Format24bppRgb);
    using (Graphics graphics = Graphics.FromImage(small)) {
      graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
      graphics.DrawImage(source, new Rectangle(0, 0, small.Width, small.Height), region,
                         GraphicsUnit.Pixel);
    }

    using var jpeg = new MemoryStream();
    using var parameters = new EncoderParameters(1);
    parameters.Param[0] = new EncoderParameter(Encoder.Quality, jpegQuality);
    small.Save(jpeg, _jpegCodec, parameters);
    return new Frame(jpeg.ToArray(), small.Width, small.Height);
  }
}
