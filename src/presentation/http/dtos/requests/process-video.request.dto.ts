import { IsString, IsNotEmpty, Length, IsOptional } from 'class-validator';

/**
 * 단일 비디오 처리 요청 DTO
 */
export class ProcessVideoRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(11, 11, { message: '비디오 ID는 정확히 11자여야 합니다' })
  videoId: string;
}

/**
 * 채널 처리 요청 DTO
 */
export class ProcessChannelRequestDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;

  @IsOptional()
  maxVideos?: number;
}

/**
 * 배치 실행 요청 DTO
 */
export class RunBatchRequestDto {
  @IsOptional()
  @IsString()
  channels?: string; // 쉼표로 구분된 채널 ID 목록 (선택사항)
}
