import Groq from "groq-sdk";
import OpenAI from "openai";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure your OpenAI API key is set in .env
});

const schema = zfd.formData({
  input: z.union([zfd.text(), zfd.file()]),
  message: zfd.repeatableOfType(
    zfd.json(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
  ),
});

export async function POST(request: Request) {
  console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

  const { data, success } = schema.safeParse(await request.formData());
  if (!success) return new Response("Invalid request", { status: 400 });

  // 1) Get transcript from either text or audio file
  const transcript = await getTranscript(data.input);
  if (!transcript) return new Response("Invalid audio", { status: 400 });

  console.timeEnd(
    "transcribe " + request.headers.get("x-vercel-id") || "local"
  );
  console.time(
    "text completion " + request.headers.get("x-vercel-id") || "local"
  );

  // 2) Call OpenAI to get chat completion
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 150,
    messages: [
      {
        role: "system",
        content: `당신은 김주환 교수입니다. 현재 연세대학교 언론홍보영상학부 교수로 재직 중이며, 언론홍보대학원장을 역임하였다. 주된 연구 및 강의분야는 내면소통, 명상, 마음근력 향상 훈련, 소통 능력, 회복탄력성, 대인관계와 커뮤니케이션, 스피치와 토론, 설득과 리더십 등이다. 신경과학과 뇌영상기법(fMRI, EEG)을 이용한 소통능력과 내면소통 명상의 효과에 대해 연구하고 있다.
        `,
      },
      ...data.message,
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const response = completion.choices[0].message.content;

  console.timeEnd(
    "text completion " + request.headers.get("x-vercel-id") || "local"
  );

  // 3) Send the text to ElevenLabs TTS (streaming)
  console.time("elevenlabs request " + request.headers.get("x-vercel-id") || "local");

  const voice = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/0drbXjihLuKuf1kkjbRc/stream",
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: response,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.9,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    }
  );

  console.timeEnd("elevenlabs request " + request.headers.get("x-vercel-id") || "local");

  if (!voice.ok) {
    console.error(await voice.text());
    return new Response("Voice synthesis failed", { status: 500 });
  }

  // 4) Stream the TTS result back to the browser
  console.time("stream " + request.headers.get("x-vercel-id") || "local");
  after(() => {
    console.timeEnd("stream " + request.headers.get("x-vercel-id") || "local");
  });

  // Include transcript and response in custom headers, just like before
  return new Response(voice.body, {
    headers: {
      "X-Transcript": encodeURIComponent(transcript || ""),
      "X-Response": encodeURIComponent(response || ""),
      "Content-Type": "audio/mpeg", // MP3 stream
    },
  });
}

function location() {
  const headersList = headers();

  const country = headersList.get("x-vercel-ip-country");
  const region = headersList.get("x-vercel-ip-country-region");
  const city = headersList.get("x-vercel-ip-city");

  if (!country || !region || !city) return "unknown";
  return `${city}, ${region}, ${country}`;
}

function time() {
  return new Date().toLocaleString("en-US", {
    timeZone: headers().get("x-vercel-ip-timezone") || undefined,
  });
}

/**
 * If input is string, return directly (user typed text).
 * If input is audio (File), call Groq SDK to transcribe it with Whisper.
 */
async function getTranscript(input: string | File) {
  if (typeof input === "string") return input;

  try {
    const { text } = await groq.audio.transcriptions.create({
      file: input,
      model: "whisper-large-v3",
    });

    return text.trim() || null;
  } catch {
    return null; // Empty audio file or error
  }
}
