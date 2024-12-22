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
    const vercelId = request.headers.get("x-vercel-id") || "local";

    // Start timing the transcription process
    console.time(`transcribe ${vercelId}`);

    // Parse and validate the incoming form data using your schema
    const { data, success } = schema.safeParse(await request.formData());
    if (!success) return new Response("Invalid request", { status: 400 });

    // Get the transcript from the audio input
    const transcript = await getTranscript(data.input);
    if (!transcript) return new Response("Invalid audio", { status: 400 });

    // End timing the transcription process
    console.timeEnd(`transcribe ${vercelId}`);

    // Start timing the text completion process
    console.time(`text completion ${vercelId}`);

    // Create a chat completion using OpenAI's API
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

    // Extract the response content from OpenAI's completion
    const response = completion.choices[0].message.content;

    // End timing the text completion process
    console.timeEnd(`text completion ${vercelId}`);

    // Start timing the Eleven Labs API request
    console.time(`elevenlabs request ${vercelId}`);

    // Ensure the ELEVENLABS_API_KEY environment variable is set
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        console.error("Missing ELEVENLABS_API_KEY environment variable");
        return new Response("Server configuration error", { status: 500 });
    }

    // Define the Eleven Labs Voice ID (replace with your actual Voice ID)
    const ELEVENLABS_VOICE_ID = "9BWtsMINqrJLrRacOk9x"; // Replace with your specific Voice ID

    // Construct the Eleven Labs API URL with query parameters
    const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?enable_logging=false&output_format=pcm_24000`;

    // Prepare the request payload
    const elevenLabsPayload = {
        text: response,
        model_id: "eleven_flash_v2_5",
        language_code: "ko",
    };

    // Make the POST request to Eleven Labs' TTS API
    const voiceResponse = await fetch(elevenLabsUrl, {
        method: "POST",
        headers: {
            "Xi-Api-Key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(elevenLabsPayload),
    });

    // End timing the Eleven Labs API request
    console.timeEnd(`elevenlabs request ${vercelId}`);

    // Handle errors from the Eleven Labs API
    if (!voiceResponse.ok) {
        const errorText = await voiceResponse.text();
        console.error(`Eleven Labs TTS Error: ${errorText}`);
        return new Response("Voice synthesis failed", { status: 500 });
    }

    // Start timing the streaming process
    console.time(`stream ${vercelId}`);

    // Ensure the 'after' function is defined in your environment
    if (typeof after === "function") {
        after(() => {
            console.timeEnd(`stream ${vercelId}`);
        });
    } else {
        console.warn("'after' function is not defined. Timing for streaming may not be accurate.");
    }

    // Return the audio stream with appropriate headers
    return new Response(voiceResponse.body, {
        headers: {
            "Content-Type": "audio/pcm", // Ensure this matches the output_format from Eleven Labs
            "X-Transcript": encodeURIComponent(transcript || ""),
            "X-Response": encodeURIComponent(response || ""),
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
