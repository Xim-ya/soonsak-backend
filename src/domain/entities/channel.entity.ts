export interface ChannelProps {
  id: string;
  name: string;
  handleId: string;
  logoUrl?: string;
  bannerUrl?: string;
  subscriberCount?: number;
  lastProcessedAt?: Date;
  isActive?: boolean;
}

/**
 * 채널 도메인 엔티티
 */
export class Channel {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _handleId: string;
  private readonly _logoUrl?: string;
  private readonly _bannerUrl?: string;
  private readonly _subscriberCount?: number;
  private _lastProcessedAt?: Date;
  private readonly _isActive: boolean;

  private constructor(props: ChannelProps) {
    this._id = props.id;
    this._name = props.name;
    this._handleId = props.handleId;
    this._logoUrl = props.logoUrl;
    this._bannerUrl = props.bannerUrl;
    this._subscriberCount = props.subscriberCount;
    this._lastProcessedAt = props.lastProcessedAt;
    this._isActive = props.isActive ?? true;
  }

  static create(props: ChannelProps): Channel {
    return new Channel(props);
  }

  static reconstitute(props: ChannelProps): Channel {
    return new Channel(props);
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get handleId(): string {
    return this._handleId;
  }

  get logoUrl(): string | undefined {
    return this._logoUrl;
  }

  get bannerUrl(): string | undefined {
    return this._bannerUrl;
  }

  get subscriberCount(): number | undefined {
    return this._subscriberCount;
  }

  get lastProcessedAt(): Date | undefined {
    return this._lastProcessedAt;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  markAsProcessed(): void {
    this._lastProcessedAt = new Date();
  }

  toProps(): ChannelProps {
    return {
      id: this._id,
      name: this._name,
      handleId: this._handleId,
      logoUrl: this._logoUrl,
      bannerUrl: this._bannerUrl,
      subscriberCount: this._subscriberCount,
      lastProcessedAt: this._lastProcessedAt,
      isActive: this._isActive,
    };
  }
}
