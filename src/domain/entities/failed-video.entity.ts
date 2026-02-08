/**
 * 실패한 비디오 엔티티
 * 배치 처리 중 실패한 비디오 추적
 */
export interface FailedVideoProps {
  id?: string;
  videoId: string;
  title: string;
  channelId?: string;
  failureReason: string;
  retryCount: number;
  isPermanentlyFailed: boolean;
  lastAttemptedAt: Date;
  createdAt: Date;
}

export class FailedVideo {
  readonly id?: string;
  readonly videoId: string;
  readonly title: string;
  readonly channelId?: string;
  readonly failureReason: string;
  readonly retryCount: number;
  readonly isPermanentlyFailed: boolean;
  readonly lastAttemptedAt: Date;
  readonly createdAt: Date;

  private constructor(props: FailedVideoProps) {
    this.id = props.id;
    this.videoId = props.videoId;
    this.title = props.title;
    this.channelId = props.channelId;
    this.failureReason = props.failureReason;
    this.retryCount = props.retryCount;
    this.isPermanentlyFailed = props.isPermanentlyFailed;
    this.lastAttemptedAt = props.lastAttemptedAt;
    this.createdAt = props.createdAt;
  }

  static create(props: Omit<FailedVideoProps, 'retryCount' | 'isPermanentlyFailed' | 'lastAttemptedAt' | 'createdAt'> & Partial<Pick<FailedVideoProps, 'retryCount' | 'isPermanentlyFailed' | 'lastAttemptedAt' | 'createdAt'>>): FailedVideo {
    return new FailedVideo({
      ...props,
      retryCount: props.retryCount ?? 0,
      isPermanentlyFailed: props.isPermanentlyFailed ?? false,
      lastAttemptedAt: props.lastAttemptedAt ?? new Date(),
      createdAt: props.createdAt ?? new Date(),
    });
  }

  static fromPersistence(props: FailedVideoProps): FailedVideo {
    return new FailedVideo(props);
  }

  /**
   * 재시도 횟수 증가 및 영구 실패 여부 판단
   */
  incrementRetry(): FailedVideo {
    const newRetryCount = this.retryCount + 1;
    const isPermanentlyFailed = newRetryCount >= 3;

    return new FailedVideo({
      id: this.id,
      videoId: this.videoId,
      title: this.title,
      channelId: this.channelId,
      failureReason: this.failureReason,
      retryCount: newRetryCount,
      isPermanentlyFailed,
      lastAttemptedAt: new Date(),
      createdAt: this.createdAt,
    });
  }

  /**
   * 실패 사유 업데이트
   */
  updateFailureReason(reason: string): FailedVideo {
    return new FailedVideo({
      id: this.id,
      videoId: this.videoId,
      title: this.title,
      channelId: this.channelId,
      failureReason: reason,
      retryCount: this.retryCount,
      isPermanentlyFailed: this.isPermanentlyFailed,
      lastAttemptedAt: new Date(),
      createdAt: this.createdAt,
    });
  }

  /**
   * 재시도 가능 여부
   */
  canRetry(): boolean {
    return !this.isPermanentlyFailed && this.retryCount < 3;
  }
}
