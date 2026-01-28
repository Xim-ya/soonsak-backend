import { SupabaseChannelRepository } from './supabase-channel.repository';
import { SupabaseClientProvider } from '../supabase-client.provider';
import { Channel } from '@/domain/entities';
import { SUPABASE_TABLES } from '../supabase-tables';
import { ChannelDBRecord } from '../mappers';

describe('SupabaseChannelRepository', () => {
  let repository: SupabaseChannelRepository;
  let mockSupabaseProvider: jest.Mocked<SupabaseClientProvider>;
  let mockQueryBuilder: Record<string, jest.Mock>;

  const mockChannelRecord: ChannelDBRecord = {
    id: 'UC123',
    name: 'Test Channel',
    handle_id: '@testchannel',
    logo_url: 'https://example.com/logo.jpg',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    const mockClient = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockSupabaseProvider = {
      getClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<SupabaseClientProvider>;

    repository = new SupabaseChannelRepository(mockSupabaseProvider);
  });

  describe('findAll', () => {
    it('should return all channels', async () => {
      mockQueryBuilder.order.mockResolvedValue({
        data: [mockChannelRecord],
        error: null,
      });

      const result = await repository.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Channel);
      expect(result[0].toProps().id).toBe('UC123');
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.CHANNELS);
    });

    it('should throw error when query fails', async () => {
      mockQueryBuilder.order.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(repository.findAll()).rejects.toThrow('Failed to get all channels');
    });

    it('should return empty array when no data', async () => {
      mockQueryBuilder.order.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return channel when found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: mockChannelRecord,
        error: null,
      });

      const result = await repository.findById('UC123');

      expect(result).toBeInstanceOf(Channel);
      expect(result?.toProps().id).toBe('UC123');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'UC123');
    });

    it('should return null when not found', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await repository.findById('UC999');

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('should save channel successfully', async () => {
      mockQueryBuilder.upsert.mockResolvedValue({
        data: null,
        error: null,
      });

      const channel = Channel.reconstitute({
        id: 'UC123',
        name: 'Test Channel',
        handleId: '@testchannel',
        logoUrl: 'https://example.com/logo.jpg',
      });

      await expect(repository.save(channel)).resolves.not.toThrow();
      expect(mockSupabaseProvider.getClient().from).toHaveBeenCalledWith(SUPABASE_TABLES.CHANNELS);
    });

    it('should throw error when save fails', async () => {
      mockQueryBuilder.upsert.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      const channel = Channel.reconstitute({
        id: 'UC123',
        name: 'Test Channel',
        handleId: '@testchannel',
      });

      await expect(repository.save(channel)).rejects.toThrow('Failed to save channel');
    });
  });

  describe('exists', () => {
    it('should return true when channel exists', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: { id: 'UC123' },
        error: null,
      });

      const result = await repository.exists('UC123');

      expect(result).toBe(true);
    });

    it('should return false when channel does not exist', async () => {
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await repository.exists('UC999');

      expect(result).toBe(false);
    });
  });

  describe('getOrCreate', () => {
    it('should return existing channel id', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: { id: 'UC123' },
        error: null,
      });

      const result = await repository.getOrCreate('UC123', 'Test Channel');

      expect(result).toBe('UC123');
    });

    it('should create and return new channel id when not exists', async () => {
      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: { id: 'UC456' }, error: null });

      const result = await repository.getOrCreate('UC456', 'New Channel');

      expect(result).toBe('UC456');
    });

    it('should return provided id when creation fails', async () => {
      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Creation failed' } });

      const result = await repository.getOrCreate('UC789', 'Failed Channel');

      expect(result).toBe('UC789');
    });
  });
});
