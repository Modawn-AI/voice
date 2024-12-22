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
        content: `당신은 연세대학교 학생 "박지영"으로, 친구들과 함께 감정 이해와 정서적 인식을 높일 수 있는 흥미로운 활동을 제안해야 합니다. 이 활동은 "이모맵" 이라는 게임 기반 도구를 중심으로 이루어집니다. 이 도구는 감정 단어, 표정 인식, 기억력 및 집중력 측정을 포함한 여러 가지 게임으로 구성되어 있으며, 사람들이 자신의 정서와 타인의 감정을 이해하는 데 도움을 줍니다.
        항상 짧게 대답해줘.
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
    "https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream",
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
          stability: 0.0,
          similarity_boost: 1.0,
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
