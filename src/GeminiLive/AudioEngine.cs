using Windows.Media.Audio;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using Windows.Media.Render;

namespace GeminiLive;

/// <summary>
/// Full-duplex voice I/O on one AudioGraph in the Communications category. Putting the mic and
/// the speaker in the same communications graph is what turns on Windows' acoustic echo
/// cancellation - the Windows twin of Android's VOICE_COMMUNICATION source. Without it Gemini
/// hears its own voice through the mic and keeps interrupting itself.
/// </summary>
public sealed class AudioEngine : IDisposable
{
    public const int MicRate = 16000;      // Live API input: 16 kHz mono PCM16
    public const int SpeakerRate = 24000;  // Live API output: 24 kHz mono PCM16
    const int MicChunkSamples = MicRate / 25; // 40 ms per WebSocket message

    AudioGraph? _graph;
    AudioFrameOutputNode? _micTap;
    AudioFrameInputNode? _speakerFeed;
    int _graphRate, _graphChannels;

    Resampler _micResampler = null!, _speakerResampler = null!;
    readonly List<short> _micPending = new(MicChunkSamples * 2);
    readonly Queue<float> _playback = new();
    readonly object _playbackGate = new();

    public event Action<byte[]>? MicChunk;
    public event Action<float>? MicLevel;
    public event Action<float>? SpeakerLevel;

    public bool Muted { get; set; }
    public bool IsPlaying { get { lock (_playbackGate) return _playback.Count > 0; } }

    public async Task StartAsync()
    {
        var settings = new AudioGraphSettings(AudioRenderCategory.Communications)
        {
            QuantumSizeSelectionMode = QuantumSizeSelectionMode.LowestLatency,
        };
        var created = await AudioGraph.CreateAsync(settings);
        if (created.Status != AudioGraphCreationStatus.Success)
            throw new InvalidOperationException($"Audio graph: {created.Status}");
        _graph = created.Graph;
        _graphRate = (int)_graph.EncodingProperties.SampleRate;
        _graphChannels = (int)_graph.EncodingProperties.ChannelCount;

        var output = await _graph.CreateDeviceOutputNodeAsync();
        if (output.Status != AudioDeviceNodeCreationStatus.Success)
            throw new InvalidOperationException($"Speaker: {output.Status}");

        var input = await _graph.CreateDeviceInputNodeAsync(MediaCategory.Communications);
        if (input.Status != AudioDeviceNodeCreationStatus.Success)
            throw new InvalidOperationException(input.Status == AudioDeviceNodeCreationStatus.AccessDenied
                ? "Microphone access is off - allow it in Settings › Privacy › Microphone"
                : $"Microphone: {input.Status}");

        // Both frame nodes run at the graph's own format; we resample ourselves so we never
        // depend on the graph converting formats for frame nodes.
        _micTap = _graph.CreateFrameOutputNode();
        input.DeviceInputNode.AddOutgoingConnection(_micTap);
        _speakerFeed = _graph.CreateFrameInputNode(_graph.EncodingProperties);
        _speakerFeed.AddOutgoingConnection(output.DeviceOutputNode);
        _speakerFeed.QuantumStarted += OnSpeakerQuantum;
        _graph.QuantumStarted += OnGraphQuantum;

        _micResampler = new Resampler(_graphRate, MicRate);
        _speakerResampler = new Resampler(SpeakerRate, _graphRate);

        Log.Write($"audio graph {_graphRate} Hz x{_graphChannels}, quantum {_graph.SamplesPerQuantum}");
        _graph.Start();
    }

    /// <summary>Queue model speech (24 kHz PCM16 little-endian) for playback.</summary>
    public void Play(ReadOnlySpan<byte> pcm16)
    {
        var mono = new float[pcm16.Length / 2];
        for (int i = 0; i < mono.Length; i++)
            mono[i] = BitConverter.ToInt16(pcm16.Slice(i * 2, 2)) / 32768f;
        var resampled = _speakerResampler.Process(mono);
        lock (_playbackGate) foreach (var s in resampled) _playback.Enqueue(s);
    }

    /// <summary>Barge-in: the user spoke over Gemini, so drop everything not yet heard.</summary>
    public void Flush()
    {
        lock (_playbackGate) _playback.Clear();
    }

    unsafe void OnGraphQuantum(AudioGraph sender, object args)
    {
        using var frame = _micTap!.GetFrame();
        using var buffer = frame.LockBuffer(Windows.Media.AudioBufferAccessMode.Read);
        using var reference = buffer.CreateReference();
        var (data, _) = Native.GetBuffer(reference);
        var floats = (float*)data;
        int frames = (int)(buffer.Length / sizeof(float) / _graphChannels);
        if (frames == 0) return;

        var mono = new float[frames];
        float peak = 0;
        for (int i = 0; i < frames; i++)
        {
            float sum = 0;
            for (int c = 0; c < _graphChannels; c++) sum += floats[i * _graphChannels + c];
            mono[i] = sum / _graphChannels;
            peak = Math.Max(peak, Math.Abs(mono[i]));
        }
        MicLevel?.Invoke(Muted ? 0 : peak);

        foreach (var s in _micResampler.Process(mono))
            _micPending.Add(Muted ? (short)0 : (short)Math.Clamp(s * 32767f, short.MinValue, short.MaxValue));

        while (_micPending.Count >= MicChunkSamples)
        {
            var bytes = new byte[MicChunkSamples * 2];
            for (int i = 0; i < MicChunkSamples; i++)
                BitConverter.TryWriteBytes(bytes.AsSpan(i * 2), _micPending[i]);
            _micPending.RemoveRange(0, MicChunkSamples);
            MicChunk?.Invoke(bytes);
        }
    }

    unsafe void OnSpeakerQuantum(AudioFrameInputNode sender, FrameInputNodeQuantumStartedEventArgs args)
    {
        int needed = args.RequiredSamples;
        if (needed == 0) return;

        var frame = new Windows.Media.AudioFrame((uint)(needed * _graphChannels * sizeof(float)));
        float peak = 0;
        using (var buffer = frame.LockBuffer(Windows.Media.AudioBufferAccessMode.Write))
        using (var reference = buffer.CreateReference())
        {
            var (data, _) = Native.GetBuffer(reference);
            var floats = (float*)data;
            lock (_playbackGate)
            {
                for (int i = 0; i < needed; i++)
                {
                    float s = _playback.Count > 0 ? _playback.Dequeue() : 0f;
                    peak = Math.Max(peak, Math.Abs(s));
                    for (int c = 0; c < _graphChannels; c++) floats[i * _graphChannels + c] = s;
                }
            }
        }
        sender.AddFrame(frame);
        SpeakerLevel?.Invoke(peak);
    }

    public void Dispose()
    {
        _graph?.Stop();
        _graph?.Dispose();
        _graph = null;
    }

    /// <summary>
    /// Streaming linear resampler. When shrinking the rate it averages the input window per output
    /// sample (a cheap anti-alias), which is plenty for speech.
    /// </summary>
    sealed class Resampler(int from, int to)
    {
        readonly double _step = (double)from / to;
        double _pos;          // where the next output sample falls, in input samples of the current chunk
        float _last;          // last input sample of the previous chunk (index -1 of this one)

        public float[] Process(float[] input)
        {
            if (from == to || input.Length == 0) return input;
            var output = new List<float>(input.Length * to / from + 2);
            float At(int i) => i < 0 ? _last : input[i];

            if (_step > 1)
            {
                while (_pos + _step <= input.Length)
                {
                    int a = Math.Max(0, (int)_pos), b = (int)(_pos + _step);
                    float sum = 0; for (int i = a; i < b; i++) sum += input[i];
                    output.Add(b > a ? sum / (b - a) : At(a - 1));
                    _pos += _step;
                }
            }
            else
            {
                while (_pos < input.Length - 1)
                {
                    int i = (int)Math.Floor(_pos); float t = (float)(_pos - i);
                    output.Add(At(i) + (At(i + 1) - At(i)) * t);
                    _pos += _step;
                }
            }
            _pos -= input.Length;
            _last = input[^1];
            return output.ToArray();
        }
    }
}
