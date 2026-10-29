// The media the fakes serve, made in code so that the checks need no binary
// fixtures: a recording for the player, and a map tile.

const RATE = 22050;

// A 2-second, 16-bit mono WAV at 22.05 kHz: a 4.5 kHz chirp in each second, from
// 0.25 to 0.75 s, over quiet noise, so that its waveform and spectrogram both have
// something to draw. The noise is seeded, so the file is the same every time.
export function recordingWav() {
  const samples = RATE * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);          // format chunk size
  wav.writeUInt16LE(1, 20);           // PCM
  wav.writeUInt16LE(1, 22);           // channels
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28);    // bytes a second
  wav.writeUInt16LE(2, 32);           // bytes a sample
  wav.writeUInt16LE(16, 34);          // bits a sample
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);

  let seed = 1;
  const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const inSecond = t % 1;
    const envelope = inSecond >= 0.25 && inSecond < 0.75 ? Math.sin(Math.PI * (inSecond - 0.25) / 0.5) : 0;
    const v = 0.6 * envelope * Math.sin(2 * Math.PI * 4500 * t) + 0.02 * noise();
    wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return wav;
}

// A 1×1 grey PNG, served for every map tile. Leaflet stretches it to the tile.
export const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4CwAA3wDeKXlwtgAAAABJRU5ErkJggg==',
  'base64',
);
