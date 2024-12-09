from flask import Flask, request, jsonify
import base64
import io
import asyncio
from hume import AsyncHumeClient
from hume.expression_measurement.stream import Config
from hume.expression_measurement.stream.socket_client import StreamConnectOptions

app = Flask(__name__)

def decode_base64_audio(base64_audio):
    try:
        # The Base64 string includes metadata like "data:audio/wav;base64,..."
        header, encoded = base64_audio.split(",", 1)
        audio_bytes = base64.b64decode(encoded)
        return io.BytesIO(audio_bytes)
    except Exception as e:
        raise ValueError(f"Error decoding Base64 audio: {str(e)}")

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.get_json()
    base64_audio = data.get('audio')

    if not base64_audio:
        return jsonify({"error": "No audio provided"}), 400

    try:
        # Decode the Base64 audio
        audio_io = decode_base64_audio(base64_audio)

        # Save the audio to a temporary WAV file for Hume AI processing
        audio_path = "temp_audio.wav"
        with open(audio_path, "wb") as f:
            f.write(audio_io.read())

        # Analyze the audio with Hume AI
        result = asyncio.run(analyze_emotion(audio_path))
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


async def analyze_emotion(transcript):
    client = AsyncHumeClient(api_key="sUC9tlDDYIqEX4NSGYZf9pVDyNL4st4AUY7HExi08geuYXew")
    model_config = Config(prosody={})
    stream_options = StreamConnectOptions(config=model_config)

    async with client.expression_measurement.stream.connect(options=stream_options) as socket:
        result = await socket.send_file(audio_file_path)
        return result

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)