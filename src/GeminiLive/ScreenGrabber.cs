using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace GeminiLive;

/// <summary>
/// One JPEG still of a monitor, downscaled. Every screen frame Gemini sees comes from here.
/// </summary>
public static class ScreenGrabber {
  public sealed record Frame(byte[] Jpeg, int Width, int Height);

  public const string MimeType = "image/jpeg";
  private const int _maxEdge = 1280;
  private const long _jpegQuality = 70;

  private static readonly ImageCodecInfo _jpegCodec =
      ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

  public static Frame Grab(MonitorInfo monitor) {
    using var full = new Bitmap(monitor.Width, monitor.Height, PixelFormat.Format24bppRgb);
    using (Graphics g = Graphics.FromImage(full)) {
      g.CopyFromScreen(monitor.X, monitor.Y, 0, 0, new Size(monitor.Width, monitor.Height),
                       CopyPixelOperation.SourceCopy);
    }

    double scale = Math.Min(1.0, (double)_maxEdge / Math.Max(monitor.Width, monitor.Height));
    using var small = new Bitmap((int)(monitor.Width * scale), (int)(monitor.Height * scale),
                                 PixelFormat.Format24bppRgb);
    using (Graphics g = Graphics.FromImage(small)) {
      g.InterpolationMode = InterpolationMode.HighQualityBilinear;
      g.DrawImage(full, 0, 0, small.Width, small.Height);
    }

    using var jpeg = new MemoryStream();
    using var parameters = new EncoderParameters(1);
    parameters.Param[0] = new EncoderParameter(Encoder.Quality, _jpegQuality);
    small.Save(jpeg, _jpegCodec, parameters);
    return new Frame(jpeg.ToArray(), small.Width, small.Height);
  }
}
