import { IsString, IsNotEmpty, MinLength } from 'class-validator';

/**
 * 채널 ID URL 파라미터 DTO
 */
export class ChannelIdParam {
  @IsString()
  @IsNotEmpty({ message: '채널 ID는 필수입니다' })
  @MinLength(1, { message: '채널 ID는 비어있을 수 없습니다' })
  channelId: string;
}
