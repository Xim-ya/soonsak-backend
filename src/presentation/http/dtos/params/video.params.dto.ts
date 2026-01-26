import { IsString, Length, Matches } from 'class-validator';

/**
 * YouTube 비디오 ID 패턴
 * 11자리 영숫자 및 하이픈, 언더스코어
 */
const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

/**
 * 비디오 ID URL 파라미터 DTO
 */
export class VideoIdParam {
  @IsString()
  @Length(11, 11, { message: '비디오 ID는 정확히 11자여야 합니다' })
  @Matches(YOUTUBE_VIDEO_ID_PATTERN, {
    message: '유효하지 않은 YouTube 비디오 ID 형식입니다',
  })
  videoId: string;
}
