import { SupabaseContentRepository } from './supabase-content.repository';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { Content } from '@/domain/entities';
import { TMDBId } from '@/domain/value-objects';
import { SUPABASE_TABLES } from '../supabase-tables';
import { ContentDBRecord } from '../mappers';

describe('SupabaseContentRepository', () => {
  let repository: SupabaseContentRepository;
  let mockSupabaseProvider: jest.Mocked<SupabaseClientProvider>;
  let mockQueryBuilder: Record<string, jest.Mock>;

  const mockContentRecord: ContentDBRecord = {
    id: 12345,
    content_type: 'movie',
    title: 'Test Movie',
    poster_path: '/poster.jpg',
    uploaded_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    const mockClient = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockSupabaseProvider = {
      getClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<SupabaseClientProvider>;

    repository = new SupabaseContentRepository(mockSupabaseProvider);
  });

  describe('findById', () => {
    it('should return content when found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: mockContentRecord,
        error: null,
      });

      const contentId = TMDBId.create(12345);
      const result = await repository.findById(contentId);

      expect(result).toBeInstanceOf(Content);
      expect(result?.toProps().id).toBe(12345);
      expect(result?.toProps().title).toBe('Test Movie');
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.CONTENTS);
    });

    it('should return null when not found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const contentId = TMDBId.create(99999);
      const result = await repository.findById(contentId);

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('should return existing content id if already exists', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: mockContentRecord,
        error: null,
      });

      const content = Content.reconstitute({
        id: 12345,
        contentType: 'movie',
        title: 'Test Movie',
        posterPath: '/poster.jpg',
      });

      const result = await repository.save(content);

      expect(result).toBe(12345);
    });

    it('should insert and return new content id when not exists', async () => {
      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: { id: 67890 }, error: null });

      const content = Content.reconstitute({
        id: 67890,
        contentType: 'tv',
        title: 'New TV Show',
        posterPath: '/newposter.jpg',
      });

      const result = await repository.save(content);

      expect(result).toBe(67890);
      expect(mockQueryBuilder.insert).toHaveBeenCalled();
    });

    it('should throw error when insert fails', async () => {
      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Insert failed' } });

      const content = Content.reconstitute({
        id: 11111,
        contentType: 'movie',
        title: 'Failed Content',
      });

      await expect(repository.save(content)).rejects.toThrow('Failed to save content');
    });
  });

  describe('exists', () => {
    it('should return true when content exists', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: { id: 12345 },
        error: null,
      });

      const contentId = TMDBId.create(12345);
      const result = await repository.exists(contentId);

      expect(result).toBe(true);
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.CONTENTS);
    });

    it('should return false when content does not exist', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const contentId = TMDBId.create(99999);
      const result = await repository.exists(contentId);

      expect(result).toBe(false);
    });
  });
});
