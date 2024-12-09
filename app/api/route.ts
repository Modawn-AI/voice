import Groq from "groq-sdk";
import OpenAI from "openai";
import { HumeClient } from "hume";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";
import { createReadStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const groq = new Groq();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const hume = new HumeClient({
  apiKey: process.env.HUME_API_KEY!,
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
  console.time("transcribe " + (request.headers.get("x-vercel-id") || "local"));
  console.log("🔹 Received request at:", new Date().toISOString());

  const formData = await request.formData();
  console.log("📥 Form data received:", formData);

  const { data, success } = schema.safeParse(formData);
  console.log("✅ Schema parsing result:", { success, data });

  if (!success) {
    console.error("❌ Invalid request data");
    return new Response("Invalid request", { status: 400 });
  }

  // Get transcript from the input
  console.log("🎙️ Starting transcription...");
  const transcript = await getTranscript(data.input);
  console.log("📝 Transcript result:", transcript);

  if (!transcript) {
    console.error("❌ Invalid audio input");
    return new Response("Invalid audio", { status: 400 });
  }
  const file = data.input as File;
  console.log("📂 File received:", file.name, file.size, file.type);

  // Convert the File to a Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Write the buffer to a temporary file
  const tempFilePath = join(tmpdir(), file.name || "uploaded_audio.wav");
  writeFileSync(tempFilePath, buffer);

  // Create a ReadStream from the temporary file
  const readStream = createReadStream(tempFilePath);

  console.log("🔄 Connecting to Hume client...");
  const socket = await hume.expressionMeasurement.stream.connect({
    config: {},
  });
  console.log("✅ Connected to Hume client");

  console.log("🚀 Sending file to Hume for prosody analysis...");
  let humeResult;
  try {
    // Pass the readStream instead of a Blob
    humeResult = await socket.sendFile({
      file: readStream,
      config: { prosody: {} },
    });
    console.log("✅ Hume result received:", JSON.stringify(humeResult, null, 2));
  } catch (error) {
    console.error("❌ Error sending file to Hume:", error);
    return new Response("Hume processing failed", { status: 500 });
  }

  function isConfig(result: any): result is { prosody: { predictions: any[] } } {
    return result && result.prosody && Array.isArray(result.prosody.predictions);
  }

  let emotion:
    | string
    | { startTime: number; endTime: number; emotions: { name: string; score: number }[] }[] = [];

  if (isConfig(humeResult)) {
    console.log("🔍 Parsing prosody predictions...");
    const prosodyPredictions = humeResult.prosody.predictions;

    emotion = prosodyPredictions.map((prediction: { start_time: number; end_time: number; emotions: any[] }) => ({
      startTime: prediction.start_time,
      endTime: prediction.end_time,
      emotions: prediction.emotions.map((emotion: { name: string; score: number }) => ({
        name: emotion.name,
        score: emotion.score,
      })),
    }));
    console.log("✅ Parsed emotions:", JSON.stringify(emotion, null, 2));
  } else {
    console.error("❌ Invalid Hume result or no prosody predictions available:", humeResult);
  }

  const emotionString = JSON.stringify(emotion, null, 2);

  console.timeEnd("transcribe " + (request.headers.get("x-vercel-id") || "local"));
  console.time("text completion " + (request.headers.get("x-vercel-id") || "local"));

  console.log("💬 Sending request to OpenAI for text completion...");
  let completion;
  try {
    completion = await openai.chat.completions.create({
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
          content: transcript + ". This is the emotional state of the user when they spoke these words. " + emotionString,
        },
      ],
    });
    console.log("✅ OpenAI completion received:", completion);
  } catch (error) {
    console.error("❌ Error during OpenAI completion:", error);
    return new Response("Text completion failed", { status: 500 });
  }
  const response = completion.choices[0].message.content;
  console.timeEnd("text completion " + (request.headers.get("x-vercel-id") || "local"));
  console.time("cartesia request " + (request.headers.get("x-vercel-id") || "local"));

  const voice = await fetch("https://api.cartesia.ai/tts/sse", {
    method: "POST",
    headers: {
      "Cartesia-Version": "2024-06-30",
      "Content-Type": "application/json",
      "X-API-Key": process.env.CARTESIA_API_KEY!,
    },
    body: JSON.stringify({
      model_id: "sonic-multilingual",
      transcript: response,
      voice: {
        mode: "id",
        id: "9c0afccc-ce37-46d7-8e68-52794655ea20",
      },
      _experimental_voice_controls :  {"speed": "slowest", "emotion": ["positivity:high"]},
      language: "ko",
      output_format: {
        container: "raw",
        encoding: "pcm_f32le",
        sample_rate: 24000,
      },
    }),
  });

  console.timeEnd("cartesia request " + (request.headers.get("x-vercel-id") || "local"));

  if (!voice.ok) {
    console.error(await voice.text());
    return new Response("Voice synthesis failed", { status: 500 });
  }

  console.time("stream " + (request.headers.get("x-vercel-id") || "local"));
  after(() => {
    console.timeEnd("stream " + (request.headers.get("x-vercel-id") || "local"));
  });

  return new Response(voice.body, {
    headers: {
      "X-Transcript": encodeURIComponent(transcript || ""),
      "X-Response": encodeURIComponent(response || ""),
      // Optionally, you could include info about prosody results in headers as well
      // "X-Prosody": encodeURIComponent(JSON.stringify(humeResult) || ""),
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

async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const { text } = await groq.audio.transcriptions.create({
			file: input,
			model: "whisper-large-v3",
		});

		return text.trim() || null;
	} catch {
		return null; // Empty audio file
	}
}

export const config = {
	runtime: 'nodejs',
  };