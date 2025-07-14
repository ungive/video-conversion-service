import { ConversionKey, m3u8CodecPriorities, M3U8RawVariant, m3u8RawVariantSchema, M3U8Variant, VideoConversionOptions } from "../../lib/types"
import * as m3u8 from 'm3u8-parser'
import { TypeCompiler } from '@sinclair/typebox/compiler';

const isM3U8PlaylistVariant = TypeCompiler.Compile(m3u8RawVariantSchema);

export async function inputM3u8(
  key: ConversionKey,
  opts: VideoConversionOptions,
): Promise<string> {
  let playlist: string | undefined
  try {
    const res = await fetch(key.url)
    if (!res.ok) {
      throw new Error(`unexpected status code: ${res.status}`);
    }
    playlist = await res.text()
  }
  catch (err) {
    throw new Error('failed to fetch m3u8 playlist', { cause: err });
  }
  const parser = new m3u8.Parser({ uri: key.url })
  parser.push(playlist)
  parser.end()
  const targetSize = Math.min(key.osz || opts.maxSize, opts.maxSize)
  const targetFrameRate = Math.min(key.ofr || opts.maxFramerate, opts.maxFramerate)
  const variants: M3U8Variant[] =
    parser.manifest.playlists
      ?.filter(p => isM3U8PlaylistVariant.Check(p))
      ?.map((p: M3U8RawVariant): M3U8Variant => ({
        width: p.attributes.RESOLUTION.width,
        height: p.attributes.RESOLUTION.height,
        frameRate: p.attributes["FRAME-RATE"],
        bandwidth: p.attributes.BANDWIDTH,
        codecs: p.attributes.CODECS,
        uri: p.uri,
      })) || []
  variants.sort((a: M3U8Variant, b: M3U8Variant) => {
    const aMax = Math.max(a.width, a.height)
    const bMax = Math.max(b.width, b.height)
    const sizeScore = scoreClosestLargest(aMax, bMax, targetSize)
    if (sizeScore !== 0) return sizeScore
    const frameRateScore = scoreClosestLargest(a.frameRate, b.frameRate, targetFrameRate)
    if (frameRateScore !== 0) return frameRateScore
    const codecsScore = scoreCodecs(a.codecs) - scoreCodecs(b.codecs)
    if (codecsScore !== 0) return codecsScore
    // if (typeof targetBandwidth !== 'undefined') {
    //   const bandwidthScore = scoreClosestLargest(a.bandwidth, b.bandwidth, targetBandwidth)
    //   return bandwidthScore
    // }
    return 0
  });
  if (variants.length === 0) {
    throw new Error('no streams in m3u8 playlist');
  }
  return variants[0].uri
}

function scoreCodecs(codecs: string | undefined): number {
  if (!codecs) return m3u8CodecPriorities.length + 1;
  const items = codecs.split(',').map(c => c.trim())
  for (let i = 0; i < m3u8CodecPriorities.length; i++) {
    if (items.find(e => e.includes(m3u8CodecPriorities[i]))) {
      return i;
    }
  }
  return m3u8CodecPriorities.length;
}

function scoreClosestLargest(a: number | undefined, b: number | undefined, target: number) {
  if (!Number.isFinite(target) || Number.isNaN(target)) {
    return 0;
  }
  if (a !== undefined && b === undefined) {
    return -1;
  }
  if (a === undefined && b !== undefined) {
    return 1;
  }
  if (a === undefined && b === undefined) {
    return 0;
  }
  const aSatisfies = a! >= target;
  const bSatisfies = b! >= target;
  if (aSatisfies && !bSatisfies) {
    return -1;
  }
  if (!aSatisfies && bSatisfies) {
    return 1;
  }
  const aDiff = Math.abs(a! - target);
  const bDiff = Math.abs(b! - target);
  return aDiff - bDiff;
}
