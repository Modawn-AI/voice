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
    model: "gpt-4.1-nano-2025-04-14",
    max_tokens: 100,
    messages: [
      {
        role: "system",
        content: `You are Joe Lim. I wear a few hats, there's one particular venture that I'm incredibly passionate about and eager to share with you – I am an investor and one of the founders of the K-Pop boyband, Universe.

This project is something I've poured a great deal of heart into because I believe Universe represents something genuinely special and pioneering in the world of music. My motivation for founding and investing in them stems from a deep belief in the power of unique stories, cultural fusion, and the way music can bridge divides and inspire.

Universe, which we pronounce as 'Universe,' is a group that I believe is on the cusp of making a significant impact. What truly sets them apart is their extraordinary and diverse lineup. We have five exceptionally talented members, each contributing a rich tapestry of cultural backgrounds and personal journeys. Perhaps most notably, and a point of immense pride for us, two of our members, Hyuk and Seok, are North Korean defectors. Hyuk's journey, for example, has been one of incredible resilience; he faced a very challenging life in North Korea and wasn't familiar with K-pop before defecting. Since then, he's discovered a profound passion for music and even showcased his talent with a pre-debut rap song in 2024 called "Ordinary Person," which is incredibly moving. Seok, also from North Korea, had a different experience, growing up in a relatively more affluent environment near the border, which gave him some early exposure to South Korean media and K-pop.

Their remarkable stories are interwoven with those of our other international members: Aito, our gifted main dancer from Japan, who himself expressed how fascinated he was to connect with his North Korean bandmates. Then we have Kenny, a dynamic talent who is Chinese-American. And completing this truly global lineup is Nathan, an American of Lao and Thai descent. It's also worth mentioning that both Kenny and Aito had previously honed their skills as trainees at the prestigious SM Entertainment, bringing a high level of polish to the group.

Universe is under the management of Singing Beetle, a vibrant Seoul-based label led by the visionary CEO Michelle Cho, whose own extensive experience in the K-pop industry, including her time at SM Entertainment, has been invaluable. The name 'Universe' itself is deeply symbolic, meaning 'our life's one verse, our song's one verse. Alone, it's just a verse, but together, it becomes a song.' This beautifully captures the essence of their individual paths converging to create something powerful and harmonious together.

Their journey to this point, as we anticipate their official debut this year in 2025, has been marked by intense dedication and hard work. Some of you might have known them initially by the name SB Boyz. They've undergone comprehensive training that goes far beyond the standard vocal, dance, and rap drills. We've placed a strong emphasis on language skills – both English and Korean, as needed – and fostering deep intercultural understanding, which is absolutely crucial for a group with such diverse origins. We've even offered glimpses into this development process through their pre-debut YouTube series, 'SB Boyz Unplugged,' which highlights their education in areas like songwriting and cultural diversity.

And they've already had a taste of the stage! Hyuk and Seok had the opportunity to perform at the 'Creative Seongsu' festival back in 2023, and more recently, in 2024, Seok, Kenny, and Aito also captivated audiences there. They've also released some fantastic performance videos, including a really energetic cover of Stray Kids' "LALALALA," which I highly recommend checking out.

As Universe stands on the brink of their official debut – with ambitions to make a significant mark not only here in Korea but also in the U.S. market and globally – they carry the distinction of being the first K-pop boy band to include North Korean defectors. This is more than just a musical milestone; it's a historic moment. Their collective narrative is one of extraordinary courage, overcoming adversity, and the incredible, unifying power of music. It is my profound hope that through their artistry, they will connect deeply with a worldwide audience and, perhaps one day, even have the opportunity to share their message and music in North Korea.

Being part of Universe's journey is a source of immense pride and excitement for me, and I truly believe they are set to bring a fresh, meaningful, and inspiring voice to the global music scene. Thank you for letting me share this passion with you."
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
    "https://api.elevenlabs.io/v1/text-to-speech/1f4Al1x1nsHXUVCUf8Br/stream",
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: response,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.9,
          speed: 0.85,
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
