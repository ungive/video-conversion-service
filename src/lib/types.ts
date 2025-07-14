import { Type, type Static } from '@fastify/type-provider-typebox'

export type InputFormat = Static<typeof inputFormatSchema>
export const inputFormatSchema = Type.Union([
  Type.Literal('mp4'),
  Type.Literal('m3u8'),
])

export type OutputFormat = Static<typeof outputFormatSchema>
export const outputFormatSchema = Type.Union([
  Type.Literal('gif'),
])

export type ContentFormat = Static<typeof contentFormatSchema>
export const contentFormatSchema = Type.Composite([
  inputFormatSchema,
  outputFormatSchema
])

export type ConversionKey = Static<typeof conversionKeySchema>
export const conversionKeySchema = Type.Object({
  // The URL from which the source video should be fetched
  url: Type.String({ format: 'uri' }),
  // The input image format
  ifm: inputFormatSchema,
  // The output image format
  ofm: outputFormatSchema,
  // Whether to preload the conversion result in the background
  pre: Type.Optional(Type.Boolean()),
  // The target output size
  osz: Type.Optional(Type.Integer({ minimum: 1 })),
  // The target output frame rate
  ofr: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
  // The target amount of GIF colors
  out_gif_colors: Type.Optional(Type.Integer({ minimum: 2, maximum: 256 })),
})

export type StringifiedJSON = string

export interface VideoConversionOptions {
  maxSize: number
  maxFramerate: number
}

export function formatToHttpContentType(format: InputFormat): string {
  switch (format) {
    case "mp4": return "video/mp4"
    case "m3u8": return "application/vnd.apple.mpegurl"
  }
}

export function formatToFfmpegFormat(format: InputFormat): string {
  switch (format) {
    case "mp4": return "mp4"
    case "m3u8": return "hls"
  }
}

export const m3u8AllowedCodecs = ['avc1', 'hvc1'];
export const m3u8CodecPriorities = ['avc1', 'hvc1'];
export type M3U8RawVariant = Static<typeof m3u8RawVariantSchema>
export const m3u8RawVariantSchema = Type.Object({
  attributes: Type.Object({
    RESOLUTION: Type.Object({
      width: Type.Number({ minimum: 1 }),
      height: Type.Number({ minimum: 1 }),
    }),
    'FRAME-RATE': Type.Optional(Type.Number({ minimum: 1 })),
    CODECS: Type.Optional(Type.RegExp((() => {
      const parts = m3u8AllowedCodecs.join('|')
      return new RegExp(`^(${parts}).*|,\\s*(${parts}).*`, 'i')
    })())),
    BANDWIDTH: Type.Optional(Type.Number({ minimum: 1 })),
  }),
  uri: Type.String({ minLength: 1 }),
});

export type M3U8Variant = Static<typeof m3u8VariantSchema>
export const m3u8VariantSchema = Type.Object({
  width: Type.Number({ minimum: 1 }),
  height: Type.Number({ minimum: 1 }),
  frameRate: Type.Optional(Type.Number({ minimum: 1 })),
  bandwidth: Type.Optional(Type.Number({ minimum: 1 })),
  codecs: Type.Optional(Type.String()),
  uri: Type.String({ minLength: 1, format: 'uri' }),
});
