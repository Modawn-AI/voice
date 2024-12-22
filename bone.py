import numpy as np
from pydub import AudioSegment
from scipy.signal import iirfilter, sosfiltfilt, convolve
from scipy.io import wavfile
import librosa

# ============================
# Configuration
# ============================
input_filename = "sample.mp3"
output_filename = "mixed_conduction_pitchshifted.mp3"

# If you have real IR files, specify them
bone_ir_file = None
cartilage_ir_file = None

# Pitch shift settings (in semitones)
pitch_shift_steps = -2  # Lower the pitch slightly (e.g., by 2 semitones)

# ============================
# Helper Functions
# ============================
def design_lowpass_sos(cutoff, fs, order=4):
    return iirfilter(order, cutoff/(0.5*fs), btype='low', ftype='butter', output='sos')

def design_peaking_sos(freq, fs, gain_db=3.0, Q=0.7):
    A = 10**(gain_db/40)
    w0 = 2 * np.pi * freq / fs
    alpha = np.sin(w0)/(2*Q)
    b0 = 1 + alpha*A
    b1 = -2*np.cos(w0)
    b2 = 1 - alpha*A
    a0 = 1 + alpha/A
    a1 = -2*np.cos(w0)
    a2 = 1 - alpha/A
    return np.array([[b0/a0, b1/a0, b2/a0, 1.0, a1/a0, a2/a0]])

def soft_clip(data, threshold=0.5):
    out = data.copy()
    mask = np.abs(out) > threshold
    diff = out[mask] - np.sign(out[mask])*threshold
    out[mask] = np.sign(out[mask]) * (threshold + diff/(1+diff**2))
    return out

def load_ir(ir_file, sr_target):
    ir_sr, ir_data = wavfile.read(ir_file)
    if ir_data.ndim > 1:
        ir_data = ir_data.mean(axis=1)
    # Ideally, resample if ir_sr != sr_target, omitted here for simplicity.
    return ir_data.astype(np.float32)

def generate_synthetic_ir(sr, duration_ms=3, freq=500, decay=6, amplitude=0.1, cutoff=4000):
    length = int(sr*(duration_ms/1000.0))
    t = np.linspace(0, duration_ms/1000.0, length, endpoint=False)
    raw_ir = amplitude * np.sin(2*np.pi*freq*t) * np.exp(-decay*t)
    lp_sos = design_lowpass_sos(cutoff, sr, order=2)
    filtered_ir = sosfiltfilt(lp_sos, raw_ir)
    return filtered_ir.astype(np.float32)

def apply_filters_and_ir(data, sr, lowpass_cutoff, mid_boost_freq, mid_boost_gain,
                         ir_data, compression=True):
    lp_sos = design_lowpass_sos(lowpass_cutoff, sr, order=4)
    filtered = sosfiltfilt(lp_sos, data)
    
    mid_sos = design_peaking_sos(mid_boost_freq, sr, gain_db=mid_boost_gain, Q=0.7)
    filtered = sosfiltfilt(mid_sos, filtered)
    
    convolved = convolve(filtered, ir_data, mode='full')
    convolved = convolved[:len(filtered)]
    
    if compression:
        convolved = soft_clip(convolved, threshold=0.5)
    
    return convolved

# ============================
# Load Input (Air Conduction)
# ============================
audio = AudioSegment.from_file(input_filename, format="mp3")
samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
if audio.channels > 1:
    samples = samples.reshape((-1, audio.channels)).mean(axis=1)

sr = audio.frame_rate
peak = np.max(np.abs(samples))
if peak > 0:
    samples = samples / peak * 0.9

# ============================
# Bone Conduction Layer
# ============================
bone_lowpass_cutoff = 4000
bone_mid_boost = 2.0
if bone_ir_file:
    bone_ir = load_ir(bone_ir_file, sr)
else:
    bone_ir = generate_synthetic_ir(sr, duration_ms=5, freq=500, decay=6, amplitude=0.1, cutoff=3000)

bone_layer = apply_filters_and_ir(samples, sr, bone_lowpass_cutoff, 300, bone_mid_boost, bone_ir, compression=True)
bone_layer *= 0.3  # Adjust blend level as desired

# ============================
# Cartilage Conduction Layer
# ============================
cartilage_lowpass_cutoff = 6000
cartilage_mid_boost = 1.0
if cartilage_ir_file:
    cartilage_ir = load_ir(cartilage_ir_file, sr)
else:
    cartilage_ir = generate_synthetic_ir(sr, duration_ms=2, freq=700, decay=8, amplitude=0.05, cutoff=5000)

cartilage_layer = apply_filters_and_ir(samples, sr, cartilage_lowpass_cutoff, 300, cartilage_mid_boost, cartilage_ir, compression=False)
cartilage_layer *= 0.5

# ============================
# Mix Layers
# ============================
air_layer = samples * 1.0
mixed = air_layer + bone_layer + cartilage_layer

peak = np.max(np.abs(mixed))
if peak > 0:
    mixed = mixed / peak * 0.9

# ============================
# Pitch Shift Down
# ============================
# librosa pitch_shift expects float64 or float32 audio
mixed_pitch_shifted = librosa.effects.pitch_shift(mixed.astype(np.float32), sr, n_steps=pitch_shift_steps)

# Normalize after pitch shift
peak = np.max(np.abs(mixed_pitch_shifted))
if peak > 0:
    mixed_pitch_shifted = mixed_pitch_shifted / peak * 0.9

# Convert to int16 for pydub
mixed_int16 = (mixed_pitch_shifted * 32767).astype(np.int16)

processed_audio = AudioSegment(
    mixed_int16.tobytes(),
    frame_rate=sr,
    sample_width=2,
    channels=1
)

processed_audio.export(output_filename, format="mp3", bitrate="192k")
print("Processing complete. Output saved to", output_filename)
