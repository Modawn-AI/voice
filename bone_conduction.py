import ffmpeg

def process_audio_to_mp3(input_file, output_file):
    """
    Processes an audio file by applying EQ approximating the provided curve, and
    saves the output as an MP3 file.

    Args:
        input_file (str): Path to the input audio file.
        output_file (str): Path to save the output processed MP3 file.
    """

    try:
        # Construct the filter graph with multiple equalizer filters
        # Each equalizer targets one frequency band with the specified gain
        (
            ffmpeg
            .input(input_file)
            .filter('equalizer', frequency=32, width_type='o', width=1, gain=2)
            .filter('equalizer', frequency=64, width_type='o', width=1, gain=3)
            .filter('equalizer', frequency=125, width_type='o', width=1, gain=3)
            .filter('equalizer', frequency=250, width_type='o', width=1, gain=2)
            .filter('equalizer', frequency=500, width_type='o', width=1, gain=2)
            # 1 kHz: no filter needed (no change)
            .filter('equalizer', frequency=2000, width_type='o', width=1, gain=0)
            .filter('equalizer', frequency=4000, width_type='o', width=1, gain=-2)
            .filter('equalizer', frequency=8000, width_type='o', width=1, gain=-3)
            .filter('equalizer', frequency=16000, width_type='o', width=1, gain=-6)
            .output(output_file, acodec='libmp3lame')
            .run(overwrite_output=True)
        )
        print(f"Processing complete. Output saved to: {output_file}")

    except ffmpeg.Error as e:
        print(f"An error occurred: {e.stderr.decode()}")

# Example usage
input_audio = 'sample.mp3'
output_audio = 'output_audio.mp3'
process_audio_to_mp3(input_audio, output_audio)
