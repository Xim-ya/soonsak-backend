import { SupabaseVideoRepository } from './supabase-video.repository';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { Video } from '@/domain/entities';
import { VideoId, TMDBId } from '@/domain/value-objects';
import { SUPABASE_TABLES } from '../supabase-tables';
import { VideoDBRecord } from '../mappers';

describe('SupabaseVideoRepository', () => {
  let repository: SupabaseVideoRepository;
  let mockSupabaseProvider: jest.Mocked<SupabaseClientProvider>;
  let mockQueryBuilder: Record<string, jest.Mock>;

  const VALID_VIDEO_ID = 'dQw4w9WgXcQ';

  const mockVideoRecord: VideoDBRecord = {
    id: VALID_VIDEO_ID,
    content_id: 12345,
    content_type: 'movie',
    title: 'Test Video',
    runtime: 120,
    thumbnail_url: 'https://example.com/thumb.jpg',
    is_primary: true,
    channel_id: 'UC123',
    includes_ending: false,
    uploaded_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    const mockClient = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockSupabaseProvider = {
      getClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<SupabaseClientProvider>;

    repository = new SupabaseVideoRepository(mockSupabaseProvider);
  });

  describe('exists', () => {
    it('should return true when video exists', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: { id: VALID_VIDEO_ID },
        error: null,
      });

      const videoId = VideoId.create(VALID_VIDEO_ID);
      const result = await repository.exists(videoId);

      expect(result).toBe(true);
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.VIDEOS);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', VALID_VIDEO_ID);
    });

    it('should return false when video does not exist', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const videoId = VideoId.create('xyzNotExist');
      const result = await repository.exists(videoId);

      expect(result).toBe(false);
    });
  });

  describe('findById', () => {
    it('should return video when found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: mockVideoRecord,
        error: null,
      });

      const videoId = VideoId.create(VALID_VIDEO_ID);
      const result = await repository.findById(videoId);

      expect(result).toBeInstanceOf(Video);
      expect(result?.toProps().id).toBe(VALID_VIDEO_ID);
      expect(result?.toProps().contentId).toBe(12345);
    });

    it('should return null when not found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const videoId = VideoId.create('xyzNotExist');
      const result = await repository.findById(videoId);

      expect(result).toBeNull();
    });
  });

  describe('findByContentId', () => {
    it('should return videos for content', async () => {
      mockQueryBuilder.eq.mockResolvedValue({
        data: [mockVideoRecord],
        error: null,
      });

      const contentId = TMDBId.create(12345);
      const result = await repository.findByContentId(contentId);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Video);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('content_id', 12345);
    });

    it('should return empty array when no videos found', async () => {
      mockQueryBuilder.eq.mockResolvedValue({
        data: null,
        error: null,
      });

      const contentId = TMDBId.create(99999);
      const result = await repository.findByContentId(contentId);

      expect(result).toEqual([]);
    });
  });

  describe('save', () => {
    it('should save video successfully', async () => {
      mockQueryBuilder.upsert.mockResolvedValue({
        data: null,
        error: null,
      });

      const video = Video.reconstitute({
        id: VALID_VIDEO_ID,
        contentId: 12345,
        contentType: 'movie',
        title: 'Test Video',
        isPrimary: true,
        includesEnding: false,
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(repository.save(video)).resolves.not.toThrow();
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.VIDEOS);
    });

    it('should throw error when save fails', async () => {
      mockQueryBuilder.upsert.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      const video = Video.reconstitute({
        id: VALID_VIDEO_ID,
        contentId: 12345,
        contentType: 'movie',
        title: 'Test Video',
        isPrimary: true,
        includesEnding: false,
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      await expect(repository.save(video)).rejects.toThrow('Failed to save video');
    });
  });

  describe('updatePrimaryStatus', () => {
    it('should update primary status successfully', async () => {
      mockQueryBuilder.eq.mockResolvedValue({
        data: null,
        error: null,
      });

      const videoId = VideoId.create(VALID_VIDEO_ID);
      await expect(repository.updatePrimaryStatus(videoId, true)).resolves.not.toThrow();
    });

    it('should throw error when update fails', async () => {
      mockQueryBuilder.eq.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      const videoId = VideoId.create(VALID_VIDEO_ID);
      await expect(repository.updatePrimaryStatus(videoId, false)).rejects.toThrow(
        'Failed to update primary status',
      );
    });
  });

  describe('findPrimaryByContentId', () => {
    it('should return primary video for content', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: mockVideoRecord,
        error: null,
      });

      const contentId = TMDBId.create(12345);
      const result = await repository.findPrimaryByContentId(contentId);

      expect(result).toBeInstanceOf(Video);
      expect(result?.toProps().isPrimary).toBe(true);
    });

    it('should return null when no primary video', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const contentId = TMDBId.create(99999);
      const result = await repository.findPrimaryByContentId(contentId);

      expect(result).toBeNull();
    });
  });

  describe('getRecentVideoIds', () => {
    it('should return recent video ids', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: [{ id: 'video1' }, { id: 'video2' }],
        error: null,
      });

      const result = await repository.getRecentVideoIds('UC123', 10);

      expect(result).toEqual(['video1', 'video2']);
    });

    it('should return empty array on error', async () => {
      mockQueryBuilder.limit.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await repository.getRecentVideoIds('UC123');

      expect(result).toEqual([]);
    });
  });

  describe('findExistingIds', () => {
    it('should return existing video ids', async () => {
      mockQueryBuilder.in.mockResolvedValue({
        data: [{ id: 'video1' }, { id: 'video3' }],
        error: null,
      });

      const result = await repository.findExistingIds(['video1', 'video2', 'video3']);

      expect(result).toEqual(['video1', 'video3']);
    });

    it('should return empty array for empty input', async () => {
      const result = await repository.findExistingIds([]);

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockQueryBuilder.in.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await repository.findExistingIds(['video1']);

      expect(result).toEqual([]);
    });
  });
});
