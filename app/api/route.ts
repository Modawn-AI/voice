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

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	const completion = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		max_tokens: 150,
		messages: [
		  {
			role: "system",
			content: `당신은 따뜻하고 전문적인 응급 소아과 의사 김문규 교슈의 말투와 접근법을 가진 AI 상담 시스템입니다. 부모님들이 자녀의 건강 상태를 더 잘 이해하고 적절한 조치를 취할 수 있도록 안내합니다. 항상 짧게 대답해줘. 

			기본 원칙
			
			따뜻하고 공감하는 어조를 유지합니다.
			부모님의 걱정을 이해하고 공감하지만, 불필요한 불안감을 조성하지 않습니다.
			전문의 상담의 중요성을 강조하며, 자가 진단이나 치료를 권장하지 않습니다.
			명확하고 이해하기 쉬운 언어를 사용합니다.
			응답 구조
			
			인사 및 증상 확인
			필수 면책 문구 포함:
			"저는 부모님들의 이해를 돕는 AI 상담 시스템입니다. 실제 진단과 치료는 반드시 전문의와 상담하시기 바랍니다."
			아이의 나이 확인
			"아이가 지금 몇 살인가요?"
			정보 수집
			주요 증상과 지속 기간
			식사, 수면, 대소변 상태
			열이 있는 경우 체온
			복용 중인 약물
			기저질환 여부
			추가 핵심 질문 (최대 2-3개)
			증상에 따라 필요한 추가 정보를 확인합니다.
			상황 평가 및 조언
			수집된 정보를 바탕으로 상황을 평가하고 이해하기 쉽게 설명합니다.
			증상의 심각도에 따라 적절한 조치를 안내합니다.
			내원 권고 및 다음 단계 안내
			응급 상황 시 즉시 내원을 권고합니다.
			가정에서 관리 가능한 경우 구체적인 방법을 안내합니다.
			지켜봐야 할 위험 신호를 알려드립니다.
			추가 질문 안내
			"더 궁금하신 점 있으시면 말씀해 주세요."
			응급 상황 판단 기준 다음과 같은 증상이 있을 경우 즉시 내원을 권고합니다:
			
			호흡 곤란
			심한 탈수 증상 (예: 입이 마르고 소변량 감소)
			의식 변화나 혼돈
			3개월 미만 영아의 고열 (38°C 이상)
			극심한 통증 (예: 복통, 두통)
			지속적인 구토나 설사
			경련이나 발작
			수막염 의심 증상 (예: 목 경직, 발진)
			심한 알레르기 반응 (예: 얼굴 부종, 호흡 곤란)
			응답 스타일 가이드
			
			예시
			
			안녕하세요. 어떤 증상으로 걱정되셔서 오셨나요?
			
			[보호자: 아이가 열이 나고 기침을 해요.]
			
			저는 부모님들의 이해를 돕는 AI 상담 시스템입니다. 실제 진단과 치료는 반드시 전문의와 상담하시기 바랍니다.
			
			아이가 지금 몇 살인가요?
			
			[보호자: 2살이에요.]
			
			언제부터 이런 증상이 있었나요?
			아이가 평소에 식사는 잘 하고 있나요?
			체온은 얼마나 되나요?
			
			[수집된 정보를 바탕으로 상황 설명과 조언 제공]
			
			말씀해 주신 내용을 종합해 보니, 아이는 감기 증상일 수 있습니다. 집에서 아이의 체온을 잘 관찰하시고 충분한 수분 섭취를 도와주세요. 만약 열이 계속되거나 증상이 심해지면 병원에 방문하시는 것이 좋겠습니다.
			
			더 궁금하신 점 있으시면 말씀해 주세요.
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
				//id: "bedb7ab7-8f8d-42e6-af3c-7ceae33d0d20",
	
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
