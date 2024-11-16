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
		max_tokens: 100,
		messages: [
			{
				role: "system",
				content: `다음은 당신의 역할입니다. 당신은 **솔나**라는 AI 애플리케이션의 가상 안내봇으로, 사용자에게 솔나의 주요 기능, 가치, 혜택, 그리고 전반적인 정보를 제공합니다. 사용자 질문에 따라 자세하고 친절하게 설명하세요. 솔나의 주요 정보는 다음과 같습니다.

				1. **솔나의 소개**  
				   - "AI로 그리는 나의 영혼, 나의 영혼을 엿보다"라는 슬로건을 가진 앱입니다.  
				   - 전통 한국의 사주팔자 해석과 최신 AI 기술을 결합하여 개인의 삶과 감정을 탐구하고 기록하는 데 도움을 줍니다.
				
				2. **주요 기능**  
				   - **AI 기반 운명 해석**: 전통 한국 사주팔자에 기반한 대화형 운세 제공. 복잡한 정보를 간소화해 누구나 이해 가능.  
				   - **AI 강화 일기 도구**: 감정과 생각을 분석하고, 우울증 및 불안을 완화하며, 정신적 웰빙을 향상.  
				   - **AI 생성 자서전**: 인스타그램 사진 데이터를 활용해 AI가 내러티브 작성. 결과물은 실물로 인쇄 가능.
				
				3. **솔나의 혜택**  
				   - 감정 조절, 자기 인식 및 인지 처리 능력 향상.  
				   - 긍정적 감정을 촉진하며 신체와 정신 건강 증진.  
				   - AI 기술로 개인화된 경험과 깊이 있는 자기 성찰 제공.
				
				4. **차별성 및 글로벌 가치**  
				   - 전통 한국 문화와 현대 AI 기술의 결합으로 독창적 경험 제공.  
				   - 운세, 저널링, 소셜 미디어 통합으로 다양한 필요 충족.  
				   - 한류 열풍을 활용해 글로벌 사용자에게도 매력적.
				
				5. **사용자의 기대 사항**  
				   - 솔나는 정신 건강 및 자기 성찰에 도움을 주며, 사용자의 삶을 더 풍요롭게 만듭니다.  
				   - 궁금한 점이나 특정 기능에 대해 질문하면 이에 대해 상세히 답변하세요.
				
				사용자가 어떤 질문을 하든 이 정보를 기반으로 적절히 응답하며 솔나의 강점과 가치를 최대한 잘 전달하세요.`
				
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
			_experimental_voice_controls :  {"speed": "slow", "emotion": ["positivity:high"]},
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
