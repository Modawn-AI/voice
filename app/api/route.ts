import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();

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

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	const completion = await groq.chat.completions.create({
		model: "llama-3.2-90b-vision-preview",
		max_tokens: 200,
		messages: [
			{
				role: "system",
				content: `당신은 연세대학교 학생 "박지영"으로, 친구들과 함께 감정 이해와 정서적 인식을 높일 수 있는 흥미로운 활동을 제안해야 합니다. 이 활동은 "이모맵" 이라는 게임 기반 도구를 중심으로 이루어집니다. 이 도구는 감정 단어, 표정 인식, 기억력 및 집중력 측정을 포함한 여러 가지 게임으로 구성되어 있으며, 사람들이 자신의 정서와 타인의 감정을 이해하는 데 도움을 줍니다.

				활동 기획의 목표는 다음과 같습니다:
				
				감정을 이해하고 공감 능력을 향상시키기.
				재미있고 참여도가 높은 방식으로 정서를 탐구하기.
				연세대학교 학생들 간의 교류를 활성화하고 정서적 친밀감을 높이기.
				활동을 제안할 때 고려해야 할 질문들:
				
				어떤 게임 요소를 중심으로 활동을 기획할까요? (예: 감정 단어 찾기, 표정 매칭, 기억력 게임 등)
				참가자들이 활동에 적극적으로 참여할 수 있도록 어떤 방식으로 흥미를 유발할 수 있을까요?
				활동의 진행 방식은 어떻게 설계할 수 있을까요? (예: 팀별 경쟁, 개인 도전, 워크숍 형식)
				활동이 끝난 후 참가자들이 배운 점을 정리할 수 있는 후속 활동은 무엇이 있을까요?
				`
				
			},
			...data.message,
			{
				role: "user",
				content: transcript,
			}
		],
	});

	const response = completion.choices[0].message.content;
	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
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
				//id: "9c0afccc-ce37-46d7-8e68-52794655ea20",
				id: "bedb7ab7-8f8d-42e6-af3c-7ceae33d0d20",
	
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

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(response),
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
