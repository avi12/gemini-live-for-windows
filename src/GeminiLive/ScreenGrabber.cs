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
      ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

  private static (int MaxEdge, long JpegQuality) Settings(Detail detail) {
    return detail == Detail.Sharp ? (2200, 85) : (1280, 70);
  }

  public static Frame Grab(MonitorInfo monitor, Detail detail = Detail.Standard) {
    (int maxEdge, long jpegQuality) = Settings(detail);
    using var full = new Bitmap(monitor.Width, monitor.Height, PixelFormat.Format24bppRgb);
    using (Graphics g = Graphics.FromImage(full)) {
      g.CopyFromScreen(monitor.X, monitor.Y, 0, 0, new Size(monitor.Width, monitor.Height),
                       CopyPixelOperation.SourceCopy);
    }

    double scale = Math.Min(1.0, (double)maxEdge /Math.Max(monitor.Width, monitor.Height));
    using var small = new Bitmap((int)(monitor.Width * scale), (int)(monitor.Height * scale),
                                 PixelFormat.Format24bppRgb);
    using (Graphics g = Graphics.FromImage(small)) {
      g.InterpolationMode = InterpolationMode.HighQualityBilinear;
      g.DrawImage(full, 0, 0, small.Width, small.Height);
    }

    using var jpeg = new MemoryStream();
    using var parameters = new EncoderParameters(1);
    parameters.Param[0] = new EncoderParameter(Encoder.Quality, jpegQuality);
    small.Save(jpeg, _jpegCodec, parameters);
    return new Frame(jpeg.ToArray(), small.Width, small.Height);
  }
}
