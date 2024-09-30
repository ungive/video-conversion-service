import { Type, type Static } from '@fastify/type-provider-typebox'

export type InputFormat = Static<typeof inputFormatSchema>
export const inputFormatSchema = Type.Union([
  Type.Literal('mp4')
])

export type OutputFormat = Static<typeof outputFormatSchema>
export const outputFormatSchema = Type.Union([
  Type.Literal('gif')
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
  ifm: inputFormatSchema,
  ofm: outputFormatSchema,
})

export type StringifiedJSON = string

export interface VideoConversionOptions {
  // Input format for ffmpeg
  ffmpegInputFormat: string
  // The maximum width and height of the resulting GIF.
  maxSize: number
}

export function formatToHttpContentType(format: InputFormat): string {
  switch (format) {
    case "mp4": return "video/mp4"
  }
}

export function formatToFfmpegFormat(format: InputFormat): string {
  switch (format) {
    case "mp4": return format
  }
}
