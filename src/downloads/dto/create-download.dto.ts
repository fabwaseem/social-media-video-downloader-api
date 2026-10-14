import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  VIDEO_FORMATS,
  VIDEO_QUALITIES,
} from "@downloader/shared";
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

const ALL_QUALITIES = [...VIDEO_QUALITIES, ...AUDIO_QUALITIES];
const ALL_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

export class CreateDownloadDto {
  @ApiProperty({ example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] })
  @MaxLength(2048)
  url!: string;

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

  @ApiPropertyOptional({ description: "Embed thumbnail into audio file" })
  @IsOptional()
  @IsBoolean()
  embedThumbnail?: boolean;

  @ApiPropertyOptional({ description: "Embed metadata and cover art" })
  @IsOptional()
  @IsBoolean()
  embedMetadata?: boolean;

  @ApiPropertyOptional({ description: "Embed chapter markers" })
  @IsOptional()
  @IsBoolean()
  embedChapters?: boolean;

  @ApiPropertyOptional({ description: "Embed subtitles into video file" })
  @IsOptional()
  @IsBoolean()
  embedSubtitles?: boolean;

  @ApiPropertyOptional({ description: "Write subtitle files beside the video" })
  @IsOptional()
  @IsBoolean()
  writeSubtitles?: boolean;

  @ApiPropertyOptional({ description: "Write the thumbnail image beside the download" })
  @IsOptional()
  @IsBoolean()
  writeThumbnail?: boolean;

  @ApiPropertyOptional({ enum: ["h264"], description: "Re-encode video to H.264" })
  @IsOptional()
  @IsIn(["h264"])
  videoCodec?: "h264";

  @ApiPropertyOptional({ description: "HTTPS callback invoked when the job finishes" })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] })
  @MaxLength(2048)
  callbackUrl?: string;

  @ApiPropertyOptional({ description: "Subtitle language code", example: "en" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z-.*,]{1,32}$/)
  subtitleLang?: string;

  @ApiPropertyOptional({ description: "Clip start (seconds)" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  clipStart?: number;

  @ApiPropertyOptional({ description: "Clip end (seconds)" })
  @IsOptional()
  @IsNumber()
  @Min(1)
  clipEnd?: number;
}
