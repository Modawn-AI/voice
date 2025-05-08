"use client";

import clsx from "clsx";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EnterIcon, LoadingIcon } from "@/lib/icons";
import { track } from "@vercel/analytics";
import { useMicVAD, utils } from "@ricky0123/vad-react";

type Message = {
  role: "user" | "assistant";
  content: string;
  latency?: number;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [isIOS, setIsIOS] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [messages, submit, isPending] = useActionState<
    Array<Message>,
    string | Blob
  >(async (prevMessages, data) => {
    // Stop any currently playing audio when a new submission starts
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const formData = new FormData();

    if (typeof data === "string") {
      formData.append("input", data);
      track("Text input");
    } else {
      formData.append("input", data, "audio.wav");
      track("Speech input");
    }

    for (const message of prevMessages) {
      formData.append("message", JSON.stringify(message));
    }

    const submittedAt = Date.now();

    const response = await fetch("/api", {
      method: "POST",
      body: formData,
    });

    const transcript = decodeURIComponent(
      response.headers.get("X-Transcript") || ""
    );
    const text = decodeURIComponent(
      response.headers.get("X-Response") || ""
    );

    if (!response.ok || !transcript || !text || !response.body) {
      if (response.status === 429) {
        toast.error("Too many requests. Please try again later.");
      } else {
        toast.error((await response.text()) || "An error occurred.");
      }

      return prevMessages;
    }

    const latency = Date.now() - submittedAt;

    // Handle MP3 Playback
    try {
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create audio element and set attributes that improve iOS compatibility
      const audio = new Audio();
      audio.preload = "auto";
      (audio as any).playsInline = true;  // Type assertion for iOS-specific property
      audio.src = audioUrl;
      
      // Store reference to the audio element
      audioRef.current = audio;
      
      // Add special handling for iOS devices
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      
      if (isIOS) {
        // On iOS, wait for canplaythrough event before playing
        audio.addEventListener('canplaythrough', function onCanPlay() {
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch(error => {
              console.error("iOS audio playback failed:", error);
              toast.error("Could not play audio on this iOS device.");
            });
          }
          // Remove listener after first trigger
          audio.removeEventListener('canplaythrough', onCanPlay);
        });
        
        // Load the audio to trigger the canplaythrough event
        audio.load();
      } else {
        // For non-iOS devices, use the original approach
        await audio.load();
        
        // Play with user gesture context
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            console.error("Audio playback failed:", error);
            
            // Error handling
            if (error.name === "NotAllowedError") {
              toast.error("Audio playback requires user interaction on this device.");
            } else if (error.name === "NotSupportedError") {
              toast.error("Audio format not supported on this device.");
            } else {
              toast.error("Audio playback failed.");
            }
          });
        }
      }

      // Cleanup the object URL after playback
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        const isFirefox = navigator.userAgent.includes("Firefox");
        if (isFirefox) {
          vad.start();
        }
      });
      
      // Add error listener for debugging
      audio.addEventListener("error", (e) => {
        console.error("Audio error:", e);
        const errorCodes: Record<number, string> = {
          1: "MEDIA_ERR_ABORTED",
          2: "MEDIA_ERR_NETWORK",
          3: "MEDIA_ERR_DECODE",
          4: "MEDIA_ERR_SRC_NOT_SUPPORTED"
        };
        
        const error = audio.error;
        if (error) {
          const errorMessage = error.code && errorCodes[error.code] ? errorCodes[error.code] : "Unknown";
          console.error(`Audio error code: ${errorMessage}`);
          toast.error(`Audio error: ${errorMessage}`);
        }
      });
    } catch (error) {
      console.error("Failed to play audio:", error);
      toast.error("Failed to play audio.");
    }

    setInput(transcript);

    return [
      ...prevMessages,
      {
        role: "user",
        content: transcript,
      },
      {
        role: "assistant",
        content: text,
        latency,
      },
    ];
  }, []);

  const vad = useMicVAD({
    startOnLoad: true,
    onSpeechStart: () => {
      // Stop audio playback when the user starts speaking
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    },
    onSpeechEnd: (audio) => {
      // Since we're not using the custom player anymore, handle accordingly
      const wav = utils.encodeWAV(audio);
      const blob = new Blob([wav], { type: "audio/wav" });
      submit(blob);
      const isFirefox = navigator.userAgent.includes("Firefox");
      console.log("isFirefox", isFirefox);
      if (isFirefox) vad.pause();
    },
    workletURL: "/vad.worklet.bundle.min.js",
    modelURL: "/silero_vad.onnx",
    positiveSpeechThreshold: 0.6,
    minSpeechFrames: 4,
    ortConfig(ort) {
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent
      );

      ort.env.wasm = {
        wasmPaths: {
          "ort-wasm-simd-threaded.wasm":
            "/ort-wasm-simd-threaded.wasm",
          "ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
          "ort-wasm.wasm": "/ort-wasm.wasm",
          "ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
        },
        numThreads: isSafari ? 1 : 4,
      };
    },
  });

  useEffect(() => {
    // Check if user is on iOS device
    const checkIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(checkIOS);
    
    function keyDown(e: KeyboardEvent) {
      if (e.key === "Enter") return inputRef.current?.focus();
      if (e.key === "Escape") {
        // Stop audio playback when Escape is pressed
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        return setInput("");
      }
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(input);
  }

  // Function to start conversation on iOS
  function handleStartConversation() {
    // Initialize audio context with user gesture
    try {
      // Create and resume AudioContext to enable audio on iOS
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      
      // Play a silent audio to fully unlock audio on iOS
      const silentAudio = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjM1LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADmADk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjU5AAAAAAAAAAAAAAAAJAM4AAAAAAAABJgZu2f7AAAAAAAAAAAAAAAAAAAAAP/7UEQAAANkAICwQoAAicMBpEQABEYYDyIgACJwwHkRAAEwQpkQZqaDEj36hv+MHYfnB9/8YO/5g7/oGD//5gfTAqD/+oMKg///UGt///qvqMB10GNQY1BkYGPgVl58CsPAwMDAwsDAQMDAwMDA4MAgICw3o8EAABgYGB3R4IAAAMDAgdvggAAAw7o8CAAAAw7o8KAgAABh3R4CAAQOCB2+CAQABAcEDt8EAgAA7fBAAIAAgYiI37hBAQ");
      silentAudio.play().catch(e => console.log("Silent audio play error:", e));
    } catch (e) {
      console.error("Audio context initialization failed:", e);
    }
    
    // This click helps initialize audio context on iOS
    if (vad && typeof vad.start === 'function') {
      vad.start();
    }
    
    // Focus on the input field
    if (inputRef.current) {
      inputRef.current.focus();
    }
    
    toast.success("Ready to chat! Try speaking or typing a message.");
    track("iOS conversation started");
  }

  return (
    <>
      <div className="pb-4 min-h-28" />

      <form
        className="rounded-full bg-neutral-200/80 dark:bg-neutral-800/80 flex items-center w-full max-w-3xl border border-transparent hover:border-neutral-300 focus-within:border-neutral-400 hover:focus-within:border-neutral-400 dark:hover:border-neutral-700 dark:focus-within:border-neutral-600 dark:hover:focus-within:border-neutral-600"
        onSubmit={handleFormSubmit}
      >
        <input
          type="text"
          className="bg-transparent focus:outline-none p-4 w-full placeholder:text-neutral-600 dark:placeholder:text-neutral-400"
          required
          placeholder="Hey I am Joe Lim. I am a founder of 1Verse. Ask me anything!"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          ref={inputRef}
        />

        <button
          type="submit"
          className="p-4 text-neutral-700 hover:text-black dark:text-neutral-300 dark:hover:text-white"
          disabled={isPending}
          aria-label="Submit"
        >
          {isPending ? <LoadingIcon /> : <EnterIcon />}
        </button>
      </form>

      {/* Show button to all users to help initialize audio context */}
      <button
        onClick={handleStartConversation}
        className="mt-4 px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-full transition-colors duration-200 max-w-xs mx-auto block"
      >
        Enable Voice Chat
      </button>

      <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
        {messages.length > 0 && (
          <p>
            {messages.at(-1)?.content}
            <span className="text-xs font-mono text-neutral-300 dark:text-neutral-700">
              {" "}
              ({messages.at(-1)?.latency}ms)
            </span>
          </p>
        )}

        {messages.length === 0 && (
          <>
            {vad.loading ? (
              <p>고민중입니다!</p>
            ) : vad.errored ? (
              <p>Failed to load speech detection.</p>
            ) : (
              <p>물어봐주세요~</p>
            )}
          </>
        )}
      </div>

      <div
        className={clsx(
          "absolute size-36 blur-3xl rounded-full bg-gradient-to-b from-red-200 to-red-400 dark:from-red-600 dark:to-red-800 -z-50 transition ease-in-out",
          {
            "opacity-0": vad.loading || vad.errored,
            "opacity-30":
              !vad.loading && !vad.errored && !vad.userSpeaking,
            "opacity-100 scale-110": vad.userSpeaking,
          }
        )}
      />
    </>
  );
}

function A(props: any) {
  return (
    <a
      {...props}
      className="text-neutral-500 dark:text-neutral-500 hover:underline font-medium"
    />
  );
}
