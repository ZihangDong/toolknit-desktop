export const AUDIO_CONVERT_LIMITS = Object.freeze({
  maxFiles: 100,
  maxBytesPerFile: 10 * 1024 * 1024 * 1024
});

export const AUDIO_TARGET_FORMATS = Object.freeze(['MP3', 'AAC', 'WAV', 'FLAC', 'ALAC', 'OGG']);
export const AUDIO_SOURCE_EXTENSIONS = Object.freeze(['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma']);
export const AUDIO_QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

const TARGET_FORMATS = new Set(AUDIO_TARGET_FORMATS);
const SOURCE_EXTENSIONS = new Set(AUDIO_SOURCE_EXTENSIONS);
const QUALITY_LEVELS = new Set(AUDIO_QUALITY_LEVELS);

const AUDIO_CONVERSION_PROFILES = Object.freeze({
  MP3: Object.freeze({
    extension: '.mp3',
    encoder: 'libmp3lame',
    argsByQuality: Object.freeze({
      low: Object.freeze(['-q:a', '6']),
      medium: Object.freeze(['-q:a', '4']),
      high: Object.freeze(['-q:a', '2'])
    })
  }),
  AAC: Object.freeze({
    extension: '.m4a',
    encoder: 'aac',
    argsByQuality: Object.freeze({
      low: Object.freeze(['-b:a', '128k', '-movflags', '+faststart']),
      medium: Object.freeze(['-b:a', '192k', '-movflags', '+faststart']),
      high: Object.freeze(['-b:a', '256k', '-movflags', '+faststart'])
    })
  }),
  WAV: Object.freeze({
    extension: '.wav',
    encoder: 'pcm_s16le',
    argsByQuality: Object.freeze({
      low: Object.freeze([]),
      medium: Object.freeze([]),
      high: Object.freeze([])
    })
  }),
  FLAC: Object.freeze({
    extension: '.flac',
    encoder: 'flac',
    argsByQuality: Object.freeze({
      low: Object.freeze(['-compression_level', '2']),
      medium: Object.freeze(['-compression_level', '5']),
      high: Object.freeze(['-compression_level', '8'])
    })
  }),
  ALAC: Object.freeze({
    extension: '.m4a',
    encoder: 'alac',
    argsByQuality: Object.freeze({
      low: Object.freeze(['-movflags', '+faststart']),
      medium: Object.freeze(['-movflags', '+faststart']),
      high: Object.freeze(['-movflags', '+faststart'])
    })
  }),
  OGG: Object.freeze({
    extension: '.ogg',
    encoder: 'libvorbis',
    argsByQuality: Object.freeze({
      low: Object.freeze(['-q:a', '3']),
      medium: Object.freeze(['-q:a', '5']),
      high: Object.freeze(['-q:a', '7'])
    })
  })
});

export class AudioConvertError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioConvertError';
    this.code = code;
  }
}

export function normalizeAudioTargetFormat(value) {
  const format = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!TARGET_FORMATS.has(format)) {
    throw new AudioConvertError('invalid_target_format', 'Unsupported target audio format.');
  }
  return format;
}

export function normalizeAudioConversionQuality(value) {
  const quality = value === undefined || value === null
    ? 'medium'
    : (typeof value === 'string' ? value.trim().toLowerCase() : '');
  if (!QUALITY_LEVELS.has(quality)) {
    throw new AudioConvertError('invalid_quality', 'Audio conversion quality must be low, medium, or high.');
  }
  return quality;
}

export function getAudioConversionProfile(targetFormat, quality) {
  const format = normalizeAudioTargetFormat(targetFormat);
  const normalizedQuality = normalizeAudioConversionQuality(quality);
  const profile = AUDIO_CONVERSION_PROFILES[format];
  return Object.freeze({
    format,
    quality: normalizedQuality,
    extension: profile.extension,
    encoder: profile.encoder,
    args: [...profile.argsByQuality[normalizedQuality]]
  });
}

export function validateAudioBatchSelection(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new AudioConvertError('missing_input', 'Select at least one audio file.');
  }
  if (files.length > AUDIO_CONVERT_LIMITS.maxFiles) {
    throw new AudioConvertError('too_many_files', `A batch can contain at most ${AUDIO_CONVERT_LIMITS.maxFiles} audio files.`);
  }
  const seen = new Set();
  for (const [index, file] of files.entries()) {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    if (!name) throw new AudioConvertError('invalid_input', `Invalid audio file at position ${index + 1}.`);
    const extension = /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() || '';
    if (!SOURCE_EXTENSIONS.has(extension)) {
      throw new AudioConvertError('unsupported_input', `Unsupported audio file at position ${index + 1}.`);
    }
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new AudioConvertError('invalid_input_size', `Audio file has an invalid size at position ${index + 1}.`);
    }
    if (size > AUDIO_CONVERT_LIMITS.maxBytesPerFile) {
      throw new AudioConvertError('input_too_large', `Audio file exceeds the ${AUDIO_CONVERT_LIMITS.maxBytesPerFile}-byte limit.`);
    }
    const identity = typeof file?.path === 'string' && file.path
      ? `path:${file.path}`
      : `file:${name}\u0000${file?.size ?? ''}`;
    if (seen.has(identity)) throw new AudioConvertError('duplicate_input', `Duplicate audio file: ${name}`);
    seen.add(identity);
  }
  return files;
}
