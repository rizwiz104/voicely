"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AnalysisResult = {
  questionType: string;
  framework: string[];
  outline: string[];
  notes?: string;
};

type ListenMode = "idle" | "listening" | "error";
type StreamMode = "pcm" | "opus";
type CoachTip = {
  title: string;
  detail: string;
};
type AnswerFeedback = {
  score: number;
  missing: string[];
  strengths: string[];
  suggestion: string;
  fillerCount: number;
};

const FILLER_WORDS = ["um", "uh", "like", "basically", "actually", "literally"];
const DEMO_PROMPTS = [
  "Tell me about a time you failed and what you learned.",
  "Design Twitter for 10 million daily active users.",
  "How would you detect a cycle in a linked list?",
  "Tell me about yourself and your background.",
  "Should remote work be the default for tech teams?",
];

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: SpeechRecognitionResult[];
};

type SpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const getSpeechRecognition = () => {
  if (typeof window === "undefined") return null;
  const BrowserRecognition =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor })
      .SpeechRecognition ||
    (window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).webkitSpeechRecognition;
  return BrowserRecognition ? new BrowserRecognition() : null;
};

const getNextSentence = (text: string, fromIndex: number) => {
  const slice = text.slice(fromIndex);
  const match = slice.match(/[.!?]/);
  if (!match || match.index === undefined) return null;
  const endIndex = fromIndex + match.index + 1;
  const sentence = text.slice(fromIndex, endIndex).trim();
  return { sentence, endIndex };
};

const detectQuestionTypeClient = (text: string) => {
  const lowered = text.toLowerCase();
  if (
    lowered.includes("tell me about a time") ||
    lowered.includes("when did you") ||
    lowered.includes("conflict") ||
    lowered.includes("challenge") ||
    lowered.includes("failed")
  ) {
    return "Behavioral";
  }
  if (
    lowered.includes("design") ||
    lowered.includes("scale") ||
    lowered.includes("architecture") ||
    lowered.includes("system") ||
    lowered.includes("traffic")
  ) {
    return "System Design";
  }
  if (
    lowered.includes("resume") ||
    lowered.includes("background") ||
    lowered.includes("experience") ||
    lowered.includes("tell me about yourself")
  ) {
    return "Resume";
  }
  if (
    lowered.includes("opinion") ||
    lowered.includes("think about") ||
    lowered.includes("should we") ||
    lowered.includes("would you")
  ) {
    return "Opinion";
  }
  return "Technical";
};

const getCoachTips = (
  analysis: AnalysisResult | null,
  fillerCount: number,
  inputLevel: number
): CoachTip[] => {
  if (!analysis) {
    return [
      {
        title: "Prompt",
        detail: "Ask a question or state your challenge to get a framework.",
      },
    ];
  }

  const tips: CoachTip[] = [];
  if (analysis.questionType === "Behavioral") {
    tips.push({
      title: "Start with context",
      detail: "Give a one-sentence situation before the task.",
    });
  }
  if (analysis.questionType === "System Design") {
    tips.push({
      title: "Clarify scope",
      detail: "Ask about scale, users, and constraints before designing.",
    });
  }
  if (analysis.questionType === "Technical") {
    tips.push({
      title: "State assumptions",
      detail: "Rephrase the problem and confirm constraints.",
    });
  }

  if (fillerCount >= 3) {
    tips.push({
      title: "Slow down",
      detail: "Take a short pause between sections to reduce fillers.",
    });
  }

  if (inputLevel < 0.08) {
    tips.push({
      title: "Speak up",
      detail: "Your input level is low. Try a clearer, louder tone.",
    });
  }

  if (!tips.length) {
    tips.push({
      title: "Keep it structured",
      detail: "Follow the framework blocks in order.",
    });
  }

  return tips.slice(0, 3);
};

export default function Home() {
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [lastAnalyzed, setLastAnalyzed] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [listenMode, setListenMode] = useState<ListenMode>("idle");
  const [statusText, setStatusText] = useState("Not listening");
  const [lastAnalyzedIndex, setLastAnalyzedIndex] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [secureContext, setSecureContext] = useState(true);
  const [streamMode, setStreamMode] = useState<StreamMode>("pcm");
  const [inputLevel, setInputLevel] = useState(0);
  const [inputGain, setInputGain] = useState(1.5);
  const [partialQuestionType, setPartialQuestionType] = useState("");
  const [practiceMode, setPracticeMode] = useState(true);
  const [questionLocked, setQuestionLocked] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(
    null
  );
  const [answerStartIndex, setAnswerStartIndex] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [demoStep, setDemoStep] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const levelSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelAnalyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const analysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef = useRef(false);

  const fillerCount = useMemo(() => {
    if (!transcript) return 0;
    return FILLER_WORDS.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      return count + (transcript.match(regex) || []).length;
    }, 0);
  }, [transcript]);

  const answerTranscript = useMemo(() => {
    if (!questionLocked) return "";
    return transcript.slice(answerStartIndex).trim();
  }, [transcript, answerStartIndex, questionLocked]);

  const answerFillerCount = useMemo(() => {
    if (!answerTranscript) return 0;
    return FILLER_WORDS.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      return count + (answerTranscript.match(regex) || []).length;
    }, 0);
  }, [answerTranscript]);

  const analyzeTranscript = useCallback(
    async (text: string, endIndex: number) => {
      if (practiceMode && questionLocked) return;
      setLastAnalyzedIndex(endIndex);
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        if (!response.ok) throw new Error("Failed to analyze");
        const data = (await response.json()) as {
          result: AnalysisResult;
          latency: number;
        };
        setAnalysis(data.result);
        setLatencyMs(data.latency);
        setLastAnalyzed(text);
        if (practiceMode) {
          setQuestionText(text);
          setQuestionLocked(true);
          setAnswerStartIndex(endIndex);
        }
      } catch (error) {
        console.error(error);
        setStatusText("Analysis failed. Try again.");
      }
    },
    [practiceMode, questionLocked]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const recognition = getSpeechRecognition();
    setSpeechSupported(Boolean(recognition));
    setSecureContext(Boolean(window.isSecureContext));
    const envMode = process.env.NEXT_PUBLIC_SMALLEST_STREAM_MODE;
    if (envMode === "opus" || envMode === "pcm") {
      setStreamMode(envMode);
    }
    const envGain = Number(process.env.NEXT_PUBLIC_INPUT_GAIN);
    if (!Number.isNaN(envGain) && envGain > 0) {
      setInputGain(envGain);
    }
  }, []);

  useEffect(() => {
    const next = getNextSentence(transcript, lastAnalyzedIndex);
    if (!next) return;
    if (next.sentence.length < 4) {
      setLastAnalyzedIndex(next.endIndex);
      return;
    }
    analyzeTranscript(next.sentence, next.endIndex);
  }, [transcript, lastAnalyzedIndex, analyzeTranscript]);

  useEffect(() => {
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
    }
    if (!transcript || transcript.length <= lastAnalyzedIndex) return;
    analysisTimeoutRef.current = setTimeout(() => {
      const remaining = transcript.slice(lastAnalyzedIndex).trim();
      if (remaining.length >= 12) {
        analyzeTranscript(remaining, transcript.length);
      }
    }, 1200);
  }, [transcript, lastAnalyzedIndex, analyzeTranscript]);

  useEffect(() => {
    if (answerTimeoutRef.current) {
      clearTimeout(answerTimeoutRef.current);
    }
    if (!practiceMode || !questionLocked) return;
    if (!answerTranscript || answerTranscript.length < 20) return;
    answerTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answer: answerTranscript,
            questionType: analysis?.questionType,
            fillers: answerFillerCount,
          }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as AnswerFeedback;
        setAnswerFeedback(data);
      } catch (error) {
        console.error(error);
      }
    }, 1200);
  }, [
    practiceMode,
    questionLocked,
    answerTranscript,
    analysis?.questionType,
    answerFillerCount,
    analyzeTranscript,
  ]);

  useEffect(() => {
    if (partialTimeoutRef.current) {
      clearTimeout(partialTimeoutRef.current);
    }
    if (!transcript.trim()) {
      setPartialQuestionType("");
      return;
    }
    partialTimeoutRef.current = setTimeout(() => {
      setPartialQuestionType(detectQuestionTypeClient(transcript));
    }, 600);
  }, [transcript]);

  useEffect(() => {
    if (listenMode !== "listening") return;
    const interval = setInterval(() => {
      const remaining = transcript.slice(lastAnalyzedIndex).trim();
      if (remaining.length >= 20) {
        analyzeTranscript(remaining, transcript.length);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [listenMode, transcript, lastAnalyzedIndex, analyzeTranscript]);

  useEffect(() => {
    if (audioGainRef.current) {
      audioGainRef.current.gain.value = inputGain;
    }
  }, [inputGain]);

  const startLevelMonitor = (stream: MediaStream) => {
    if (levelRafRef.current) return;
    const audioContext = audioContextRef.current || new AudioContext();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    levelSourceRef.current = source;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    levelAnalyserRef.current = analyser;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setInputLevel(rms);
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const stopListening = () => {
    listeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    audioGainRef.current?.disconnect();
    audioGainRef.current = null;
    levelSourceRef.current?.disconnect();
    levelSourceRef.current = null;
    levelAnalyserRef.current?.disconnect();
    levelAnalyserRef.current = null;
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setInputLevel(0);
    setListenMode("idle");
    setStatusText("Not listening");
  };

  const startWebSpeech = () => {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setListenMode("error");
      setStatusText("Speech recognition not supported. Use Chrome.");
      return;
    }
    if (!window.isSecureContext) {
      setListenMode("error");
      setStatusText("Mic requires HTTPS or localhost");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        startLevelMonitor(stream);
      })
      .catch(() => {
        setStatusText("Mic permission needed");
      });
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    if ("maxAlternatives" in recognition) {
      (recognition as SpeechRecognitionInstance & { maxAlternatives?: number })
        .maxAlternatives = 1;
    }

    recognition.onstart = () => {
      setListenMode("listening");
      setStatusText("Listening with browser speech");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscriptRef.current += `${result[0].transcript} `;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript((finalTranscriptRef.current + interim).trim());
    };

    recognition.onerror = () => {
      setListenMode("error");
      setStatusText("Speech recognition error. Check mic permissions.");
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        recognition.start();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setListenMode("error");
      setStatusText("Speech recognition blocked. Try Chrome or reload.");
    }
    listeningRef.current = true;
  };

  const startSmallest = async (wsUrl: string, mode: StreamMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      if (mode === "pcm" && !audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      }
      startLevelMonitor(stream);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setListenMode("listening");
        setStatusText(`Listening with Smallest streaming (${mode})`);
        if (mode === "opus") {
          const recorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
          });
          recorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };
          recorder.start(250);
          return;
        }

        const audioContext =
          audioContextRef.current || new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        const source =
          audioSourceRef.current || audioContext.createMediaStreamSource(stream);
        audioSourceRef.current = source;
        const gainNode = audioContext.createGain();
        gainNode.gain.value = inputGain;
        audioGainRef.current = gainNode;
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        audioProcessorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const buffer = new ArrayBuffer(input.length * 2);
          const view = new DataView(buffer);
          for (let i = 0; i < input.length; i += 1) {
            let sample = Math.max(-1, Math.min(1, input[i]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(i * 2, sample, true);
          }
          ws.send(buffer);
        };

        source.connect(gainNode);
        gainNode.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as { text?: string };
          if (data?.text) {
            setTranscript((prev) => `${prev} ${data.text}`.trim());
          }
        } catch {
          // Ignore non-JSON frames
        }
      };

      ws.onerror = () => {
        setListenMode("error");
        setStatusText("Smallest stream error, switching fallback");
        stopListening();
        startWebSpeech();
      };
    } catch (error) {
      console.error(error);
      setListenMode("error");
      setStatusText("Mic permission needed");
    }
  };

  const startListening = async () => {
    if (listenMode === "listening") return;
    listeningRef.current = true;
    const smallestWsUrl = process.env.NEXT_PUBLIC_SMALLEST_WS_URL;
    if (smallestWsUrl) {
      await startSmallest(smallestWsUrl, streamMode);
      return;
    }
    startWebSpeech();
  };

  const resetPractice = () => {
    setAnalysis(null);
    setLatencyMs(null);
    setLastAnalyzed("");
    setLastAnalyzedIndex(0);
    setQuestionText("");
    setQuestionLocked(false);
    setAnswerFeedback(null);
    setAnswerStartIndex(0);
    setDemoStep(0);
  };

  const runDemoPrompt = (prompt: string) => {
    stopListening();
    resetPractice();
    finalTranscriptRef.current = prompt;
    setTranscript(prompt);
    setLastAnalyzedIndex(0);
    analyzeTranscript(prompt, prompt.length);
  };

  const runDemoSequence = () => {
    stopListening();
    resetPractice();
    setPracticeMode(true);
    setDemoMode(true);
    const prompt = DEMO_PROMPTS[demoStep % DEMO_PROMPTS.length];
    runDemoPrompt(prompt);
    demoTimeoutRef.current = setTimeout(() => {
      const answer =
        demoStep % 2 === 0
          ? "Requirements: 10M DAU, low latency timelines, high write throughput. Architecture: API gateway, services, cache. Data model: users, tweets, timelines. Scaling: sharding, CDN, queues. Tradeoffs: consistency vs latency."
          : "Situation: launched a feature that regressed performance. Task: fix quickly. Action: profiled queries, rolled back, added caching. Result: 45% latency reduction and better tests.";
      finalTranscriptRef.current = `${prompt} ${answer}`;
      setTranscript(finalTranscriptRef.current);
      setAnswerStartIndex(prompt.length);
      setQuestionLocked(true);
      setDemoStep((prev) => prev + 1);
      demoTimeoutRef.current = setTimeout(() => {
        setDemoMode(false);
      }, 1200);
    }, 1600);
  };

  useEffect(() => {
    return () => stopListening();
  }, []);

  useEffect(() => {
    return () => {
      if (demoTimeoutRef.current) {
        clearTimeout(demoTimeoutRef.current);
      }
    };
  }, []);

  const coachTips = getCoachTips(analysis, fillerCount, inputLevel);

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 right-[-10%] h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute left-[-15%] top-40 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute bottom-[-10%] right-1/3 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_60%)]" />
      </div>
      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-3 rounded-3xl border border-zinc-800/70 bg-zinc-900/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                Voicely
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                Structured Thinking Coach
              </h1>
            </div>
            <div className="rounded-full border border-zinc-700/70 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-300">
              Latency target: &lt; 1.5s
            </div>
          </div>
          <p className="max-w-2xl text-sm text-zinc-400">
            Real-time voice AI that listens, classifies question types, and
            provides a framework to think clearly under pressure.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-6 shadow-[0_0_30px_rgba(16,185,129,0.08)] backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Live Transcript</h2>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span
                  className={`h-2 w-2 rounded-full ${
                    listenMode === "listening" ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
                {statusText}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-zinc-400">
                Mode:{" "}
                <span className="text-zinc-200">
                  {practiceMode ? "Practice flow" : "Open listening"}
                </span>
              </div>
              <button
                className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-300"
                onClick={() => {
                  resetPractice();
                  setPracticeMode((prev) => !prev);
                }}
              >
                Toggle {practiceMode ? "Open" : "Practice"} Mode
              </button>
            </div>
            <div className="mt-4 min-h-[180px] rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-4 text-sm text-zinc-200 shadow-inner">
              {transcript || "Start speaking to see the transcript..."}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-300">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-[0_0_16px_rgba(16,185,129,0.35)] transition hover:bg-emerald-400"
                  onClick={startListening}
                >
                  Start Listening
                </button>
                <button
                  className="rounded-full border border-zinc-700/80 bg-zinc-950/60 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500"
                  onClick={stopListening}
                >
                  Stop
                </button>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Streaming mode
                  <select
                    className="rounded-full border border-zinc-700/80 bg-zinc-950 px-3 py-1 text-xs text-zinc-200"
                    value={streamMode}
                    onChange={(event) =>
                      setStreamMode(event.target.value as StreamMode)
                    }
                  >
                    <option value="pcm">PCM (16 kHz)</option>
                    <option value="opus">Opus (WebM)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Input boost
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={inputGain}
                    onChange={(event) =>
                      setInputGain(Number(event.target.value))
                    }
                  />
                  <span className="text-zinc-200">{inputGain.toFixed(1)}x</span>
                </label>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                <span>Filler count</span>
                <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-200">
                  {fillerCount}
                </span>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Input level</span>
                <span>{inputLevel.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-zinc-800/80">
                <div
                  className="h-2 rounded-full bg-emerald-400 transition-all shadow-[0_0_12px_rgba(16,185,129,0.45)]"
                  style={{ width: `${Math.min(1, inputLevel * 4) * 100}%` }}
                />
              </div>
              {inputLevel > 0 && inputLevel < 0.08 && (
                <p className="mt-2 text-xs text-amber-300">
                  Input is very low. Try speaking louder or increase boost.
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Tip: set `NEXT_PUBLIC_SMALLEST_WS_URL` to enable Smallest streaming.
              Otherwise browser speech recognition is used for the demo.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Optional: set `NEXT_PUBLIC_SMALLEST_STREAM_MODE=pcm` (default) or
              `opus` depending on your Smallest settings.
            </p>
            <div className="mt-4 rounded-2xl border border-zinc-800/70 bg-zinc-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Demo prompts
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                <button
                  className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 transition hover:border-emerald-300"
                  onClick={runDemoSequence}
                >
                  {demoMode ? "Demo running..." : "Auto Demo (90s)"}
                </button>
                <span>Plays a question + sample answer flow.</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEMO_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-300"
                    onClick={() => runDemoPrompt(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            {!speechSupported && (
              <p className="mt-2 text-xs text-amber-300">
                Speech recognition is not supported in this browser. Use Chrome
                or Edge for the demo.
              </p>
            )}
            {!secureContext && (
              <p className="mt-2 text-xs text-amber-300">
                Microphone access requires HTTPS or localhost. Make sure you are
                on `http://localhost:3000`.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold">Detected Question Type</h2>
              <p className="mt-3 text-2xl font-semibold text-emerald-300">
                {analysis?.questionType ?? "Waiting for input"}
              </p>
              {partialQuestionType && !analysis?.questionType && (
                <div className="mt-2 text-xs text-zinc-400">
                  Live guess:{" "}
                  <span className="text-emerald-200">
                    {partialQuestionType}
                  </span>
                </div>
              )}
              <div className="mt-4 text-xs text-zinc-400">
                Last analyzed sentence:
              </div>
              <div className="mt-2 rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3 text-sm text-zinc-200 shadow-inner">
                {lastAnalyzed || "No sentence analyzed yet."}
              </div>
              {practiceMode && (
                <div className="mt-4 rounded-2xl border border-zinc-800/70 bg-zinc-950/60 p-3 text-sm text-zinc-200">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Practice flow
                  </p>
                  <div className="mt-2 rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200 shadow-inner">
                    {questionText || "Waiting for a question..."}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span
                      className={`rounded-full border px-2 py-1 ${
                        questionLocked
                          ? "border-emerald-500/40 text-emerald-200"
                          : "border-zinc-700 text-zinc-400"
                      }`}
                    >
                      1. Question detected
                    </span>
                    <span
                      className={`rounded-full border px-2 py-1 ${
                        questionLocked
                          ? "border-emerald-500/40 text-emerald-200"
                          : "border-zinc-700 text-zinc-400"
                      }`}
                    >
                      2. Answer coaching
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">
                    {questionLocked
                      ? "Answer now. We will score structure and clarity."
                      : "Ask a question or click a demo prompt."}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-6 backdrop-blur">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Framework Generator</h2>
                <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300">
                  {latencyMs ? `${latencyMs}ms` : "--"} latency
                </span>
              </div>
              <div className="mt-4 space-y-3 text-sm text-zinc-200">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Framework
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(analysis?.framework || []).map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
                      >
                        {item}
                      </span>
                    ))}
                    {!analysis?.framework?.length && (
                      <span className="text-zinc-500">
                        Awaiting framework...
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Suggested outline
                  </p>
                  <div className="mt-2 space-y-2 text-sm text-zinc-200">
                    {(analysis?.outline || []).map((item) => (
                      <div
                        key={item}
                        className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner"
                      >
                        {item}
                      </div>
                    ))}
                    {!analysis?.outline?.length && (
                      <span className="text-zinc-500">
                        Outline will appear after analysis.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold">Coach Guidance</h2>
              <div className="mt-4 space-y-3 text-sm text-zinc-200">
                {coachTips.map((tip) => (
                  <div
                    key={tip.title}
                    className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {tip.title}
                    </p>
                    <p className="mt-2">{tip.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {practiceMode && (
              <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-6 backdrop-blur">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Answer Quality Feedback</h2>
                  <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300">
                    {answerFeedback
                      ? `${Math.round(answerFeedback.score * 100)}%`
                      : "--"}
                  </span>
                </div>
                <div className="mt-3 text-xs text-zinc-400">Answer transcript</div>
                <div className="mt-2 rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3 text-sm text-zinc-200 shadow-inner">
                  {answerTranscript || "Answer will appear here."}
                </div>
                <div className="mt-4 grid gap-3 text-sm text-zinc-200">
                  <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Missing components
                    </p>
                    <p className="mt-2 text-zinc-200">
                      {answerFeedback?.missing?.length
                        ? answerFeedback.missing.join(", ")
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Strengths
                    </p>
                    <p className="mt-2 text-zinc-200">
                      {answerFeedback?.strengths?.length
                        ? answerFeedback.strengths.join(", ")
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Suggested improvement
                    </p>
                    <p className="mt-2 text-zinc-200">
                      {answerFeedback?.suggestion || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2 shadow-inner">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Filler summary
                    </p>
                    <p className="mt-2 text-zinc-200">
                      {answerFeedback
                        ? `${answerFeedback.fillerCount} filler words`
                        : `${answerFillerCount} filler words`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
