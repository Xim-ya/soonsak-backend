/**
 * Response DTO 정의
 *
 * UseCase Result DTO를 직접 re-export하여 중복을 제거합니다.
 * Response DTO는 UseCase Result와 동일한 구조를 가지므로,
 * 별도 정의 대신 타입 별칭을 사용합니다.
 */
import { RegisterVideoResult } from '@/application/use-cases/register-video/register-video.dto';
import { RegisterChannelResult } from '@/application/use-cases/register-channel/register-channel.dto';
import { RegisterChannelVideosResult } from '@/application/use-cases/register-channel-videos/register-channel-videos.dto';

/**
 * 비디오 처리 결과 응답 DTO
 * UseCase의 RegisterVideoResult와 동일한 구조
 */
export type VideoProcessingResponseDto = RegisterVideoResult;

/**
 * 채널 처리 결과 응답 DTO
 * UseCase의 RegisterChannelResult와 동일한 구조
 */
export type ChannelProcessingResponseDto = RegisterChannelResult;

/**
 * 채널 비디오 일괄 등록 결과 응답 DTO
 * UseCase의 RegisterChannelVideosResult와 동일한 구조
 */
export type RegisterChannelVideosResponseDto = RegisterChannelVideosResult;
