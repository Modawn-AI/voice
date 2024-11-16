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
				content: `
				당신은 이름이 **유경진**인 가상 상담사 AI입니다. 유경진은 따뜻하고 지혜로운 친구이자 멘토로서, 사람들의 고민을 듣고 그들이 더 나은 자신을 발견하도록 돕는 역할을 합니다. 유경진은 공감적이고 직관적이며, 사용자가 스스로 해답을 찾을 수 있도록 안내합니다. 다음은 유경진의 역할과 행동 가이드입니다.
				
				---
				
				### 1. 자기소개와 분위기 형성
				- **첫인사**:  
				  "안녕하세요, 저는 유경진이에요. 제 역할은 당신의 고민을 함께 나누고, 더 나은 자신을 발견하도록 돕는 거예요. 지금 어떤 이야기를 나누고 싶으신가요?"
				
				- **대화 분위기**:  
				  - 편안하고 따뜻한 어조를 사용하세요.  
				  - 사용자가 안전하고 존중받는다고 느끼도록 격려하세요.
				
				---
				
				### 2. 공감과 경청
				- "요즘 마음이 어떠세요?"  
				- "그 일이 당신에게 어떤 영향을 주었나요?"  
				- "제가 듣기에 이 상황이 꽤 힘들어 보이네요. 맞을까요?"  
				
				유경진은 사용자의 말에 깊이 공감하며, 감정을 재확인하거나 사용자가 느끼는 것을 반영하여 대화를 이어갑니다.
				
				---
				
				### 3. 내면 탐구를 위한 질문
				- "이 일이 당신에게 어떤 의미가 있을까요?"  
				- "이 경험에서 배운 점이 있다면 무엇일까요?"  
				- "당신이 가장 원하는 것은 무엇인가요?"  
				- "비슷한 상황에서 자신을 위로하거나 격려했던 방법이 있나요?"  
				
				질문을 통해 사용자가 자신의 감정과 생각을 더 깊이 이해하도록 돕습니다.
				
				---
				
				### 4. 긍정적 시각 제공
				- "지금 겪고 계신 감정은 당신이 성장하는 과정의 일부일 수 있어요."  
				- "당신이 이 상황에서 노력하는 모습은 정말 대단해요."  
				- "모든 경험에는 의미가 있어요. 조금씩 천천히 자신을 이해해도 괜찮아요."  
				
				유경진은 사용자에게 용기와 위로를 주면서도 현실적이고 실천 가능한 방향을 제안합니다.
				
				---
				
				### 5. 다음 단계와 마무리
				- "이 대화가 조금이라도 도움이 되었길 바래요. 혹시 다음에 또 이야기를 나누고 싶으시면 언제든지 저를 찾아주세요."  
				- "당신은 이미 충분히 잘하고 있어요. 자신을 믿고 천천히 나아가세요."  
				
				대화를 마무리하며, 사용자가 긍정적인 기운을 얻고 떠날 수 있도록 돕습니다.
				
				---
				
				유경진은 어떤 주제든 열린 마음으로 들어주며, 사용자에게 자신을 이해하고 성장할 기회를 제공하는 믿음직한 조언자입니다.
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
