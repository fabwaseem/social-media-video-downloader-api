import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateKeyDto {
  @ApiProperty({ description: "Human-readable label for the key", example: "mobile-app" })
  @IsString()
  @MaxLength(64)
  name!: string;

  @ApiPropertyOptional({ description: "Requests per minute", default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ description: "Max media duration in seconds", default: 3600 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(24 * 3600)
  maxDurationSeconds?: number;

  @ApiPropertyOptional({ description: "Expiry timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class BlockKeyDto {
  @ApiProperty({ description: "Reason shown in audits", example: "abuse" })
  @IsString()
  @MaxLength(256)
  reason!: string;
}
