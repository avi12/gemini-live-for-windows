using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace GeminiLive;

/// <summary>
/// Runs the pill's window as a child Node process and speaks the state protocol to it over stdio:
/// the latest <see cref="PillView"/> goes out as a snapshot (coalesced, and ahead of any answer, so
/// the state already shows an action's result when it is answered), and every action that comes
/// back goes to <c>onAction</c>, whose refusal is the answer's error. A window that dies is started
/// again.
/// </summary>
public sealed class PillHost : IDisposable {
  private const int _maxRapidRestarts = 5;
  private static readonly TimeSpan _frameInterval = TimeSpan.FromMilliseconds(16);
  private static readonly TimeSpan _restartDelay = TimeSpan.FromSeconds(1);
  private static readonly TimeSpan _stableRun = TimeSpan.FromSeconds(10);
  private static readonly UTF8Encoding _utf8 = new(encoderShouldEmitUTF8Identifier: false);

  private readonly Func<PillAction, Task> _onAction;
  private readonly CancellationTokenSource _stopped = new();
  private readonly SemaphoreSlim _writeGate = new(1, 1);
  private readonly Channel<bool> _changed = Channel.CreateBounded<bool>(
      new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

  private PillView? _latest;
  private string? _lastSent;
  private long _lastId;
  private Process? _process;

  public PillHost(Func<PillAction, Task> onAction) {
    _onAction = onAction;
  }

  /// <summary>The window's handle, once it is up; zero before.</summary>
  public IntPtr WindowHandle {
    get {
      _process?.Refresh();
      return _process?.MainWindowHandle ?? IntPtr.Zero;
    }
  }

  /// <summary>Starts the window; throws when Node or the bundle is missing, rather than guess.</summary>
  public void Start() {
    PillSidecar.Launch launch;
    try {
      launch = PillSidecar.Resolve();
    } catch (FileNotFoundException e) {
      Log.Write($"pill: {e.Message}");
      throw;
    }

    _ = RunAsync(launch);
  }

  /// <summary>Offers the state; the window gets it soon, and only the newest of a burst.</summary>
  public void Publish(PillView view) {
    _latest = view;
    _changed.Writer.TryWrite(true);
  }

  public void Dispose() {
    _stopped.Cancel();

    try {
      if (_process is { HasExited: false } process) {
        process.Kill(entireProcessTree: true);
      }
    } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) {
      Log.Write($"pill: could not stop the window: {e.Message}");
    }
  }

  private async Task RunAsync(PillSidecar.Launch launch) {
    int rapid = 0;
    while (!_stopped.IsCancellationRequested) {
      var run = Stopwatch.StartNew();
      int code = await RunOnceAsync(launch);
      if (_stopped.IsCancellationRequested) {
        return;
      }

      Log.Write($"pill: the window exited with {code}");
      rapid = run.Elapsed < _stableRun ? rapid + 1 : 0;

      if (rapid > _maxRapidRestarts) {
        Log.Write("pill: the window keeps exiting; giving up");
        return;
      }

      await Task.Delay(_restartDelay);
    }
  }

  private async Task<int> RunOnceAsync(PillSidecar.Launch launch) {
    try {
      using Process process = Start(launch);
      _process = process;
      _lastSent = null;
      _changed.Writer.TryWrite(true);

      using var run = CancellationTokenSource.CreateLinkedTokenSource(_stopped.Token);
      Task pumps = Task.WhenAll(PumpOutAsync(process, run.Token), PumpErrorsAsync(process));
      await PumpInAsync(process);
      await run.CancelAsync();
      await pumps;
      await process.WaitForExitAsync();
      return process.ExitCode;
    } catch (Exception e) when (e is not OperationCanceledException) {
      Log.Write($"pill: {e}");
      return -1;
    }
  }

  private static Process Start(PillSidecar.Launch launch) {
    var info = new ProcessStartInfo(launch.NodeExe) {
      WorkingDirectory = AppContext.BaseDirectory,
      UseShellExecute = false,
      CreateNoWindow = true,
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      StandardInputEncoding = _utf8,
      StandardOutputEncoding = _utf8,
      StandardErrorEncoding = _utf8,
      ArgumentList = { launch.Entry },
      Environment = { [PillSidecar.HostPidVariable] = Environment.ProcessId.ToString(CultureInfo.InvariantCulture) },
    };
    if (UpdateChecker.Installed is not null) {
      info.Environment[PillSidecar.PackagedVariable] = "1";
    }

    return Process.Start(info) ?? throw new InvalidOperationException("The pill's window did not start");
  }

  private async Task PumpOutAsync(Process process, CancellationToken token) {
    try {
      while (await _changed.Reader.WaitToReadAsync(token)) {
        _changed.Reader.TryRead(out _);
        await SendAsync(process, answer: null);
        await Task.Delay(_frameInterval, token);
      }
    } catch (OperationCanceledException) {
      // The window ended, or the app is.
    }
  }

  private static async Task PumpErrorsAsync(Process process) {
    while (await process.StandardError.ReadLineAsync() is { } line) {
      Log.Write($"pill: {line}");
    }
  }

  private async Task PumpInAsync(Process process) {
    while (await process.StandardOutput.ReadLineAsync() is { } line) {
      if (PillWire.ReadRequest(line) is { } request) {
        await SendAsync(process, PillWire.Answer(request.Id, await RunActionAsync(request)));
      }
    }
  }

  private async Task<string?> RunActionAsync(PillRequest request) {
    if (request.Type != PillFrameType.Action) {
      return $"Nothing handles '{request.RawType}'";
    }

    try {
      await _onAction(PillActionParser.Parse(request.Data));
      return null;
    } catch (FormatException e) {
      Log.Write($"pill: refused an action: {e.Message}");
      return e.Message;
    } catch (Exception e) {
      Log.Write($"pill: action failed: {e}");
      return e.Message;
    }
  }

  /// <summary>Writes the newest state if it changed, then the answer, so the answer never overtakes it.</summary>
  private async Task SendAsync(Process process, string? answer) {
    await _writeGate.WaitAsync();
    try {
      if (_latest is { } view) {
        JsonNode data = PillWire.SnapshotData(view);
        string text = data.ToJsonString();
        if (text != _lastSent) {
          _lastSent = text;
          await process.StandardInput.WriteLineAsync(PillWire.Snapshot(++_lastId, data));
        }
      }

      if (answer is not null) {
        await process.StandardInput.WriteLineAsync(answer);
      }

      await process.StandardInput.FlushAsync();
    } finally {
      _writeGate.Release();
    }
  }
}
