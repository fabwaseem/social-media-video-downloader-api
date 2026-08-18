import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  VIDEO_FORMATS,
  VIDEO_QUALITIES,
} from "@vidyoza/shared";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUrl,
  MaxLength,
} from "class-validator";

const ALL_QUALITIES = [...VIDEO_QUALITIES, ...AUDIO_QUALITIES];
const ALL_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

/** Ceiling per request. The queue's own backlog cap still applies on top. */
export const MAX_BATCH_URLS = 50;

export class CreateBatchDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_BATCH_URLS,
    example: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BATCH_URLS)
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] }, { each: true })
  @MaxLength(2048, { each: true })
  urls!: string[];

  @ApiProperty({ enum: ["video", "audio"] })
  @IsIn(["video", "audio"])
  kind!: "video" | "audio";

  @ApiPropertyOptional({ enum: ALL_QUALITIES, default: "highest / best" })
  @IsOptional()
  @IsIn(ALL_QUALITIES)
  quality?: (typeof ALL_QUALITIES)[number];

  @ApiPropertyOptional({ enum: ALL_FORMATS, default: "mp4 / mp3" })
  @IsOptional()
  @IsIn(ALL_FORMATS)
  format?: (typeof ALL_FORMATS)[number];

  @ApiPropertyOptional({ description: "Embed thumbnail into audio files" })
  @IsOptional()
  @IsBoolean()
  embedThumbnail?: boolean;
}
