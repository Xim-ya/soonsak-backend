import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ChannelsController } from '@/presentation/http/controllers/channels.controller';
import {
  RegisterChannelUseCase,
  RegisterChannelVideosUseCase,
  RegisterChannelResult,
  RegisterChannelVideosResult,
} from '@/application/use-cases';

describe('ChannelsController (e2e)', () => {
  let app: INestApplication;
  let mockRegisterChannelUseCase: jest.Mocked<RegisterChannelUseCase>;
  let mockRegisterChannelVideosUseCase: jest.Mocked<RegisterChannelVideosUseCase>;

  const VALID_CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

  beforeEach(async () => {
    mockRegisterChannelUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RegisterChannelUseCase>;

    mockRegisterChannelVideosUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RegisterChannelVideosUseCase>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [
        {
          provide: RegisterChannelUseCase,
          useValue: mockRegisterChannelUseCase,
        },
        {
          provide: RegisterChannelVideosUseCase,
          useValue: mockRegisterChannelVideosUseCase,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /channels/:channelId/register', () => {
    it('should register channel successfully', async () => {
      const mockResponse: RegisterChannelResult = {
        channelId: VALID_CHANNEL_ID,
        channelName: 'Test Channel',
        processedCount: 10,
        successCount: 8,
        failedCount: 2,
        skippedCount: 0,
        skippedShortsCount: 0,
        skippedPermanentlyFailedCount: 0,
        errors: [],
        failedVideos: [],
      };

      mockRegisterChannelUseCase.execute.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .post(`/channels/${VALID_CHANNEL_ID}/register`)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(mockRegisterChannelUseCase.execute).toHaveBeenCalledWith({
        channelId: VALID_CHANNEL_ID,
      });
    });

    it('should handle use case errors', async () => {
      mockRegisterChannelUseCase.execute.mockRejectedValue(
        new Error('Channel not found'),
      );

      await request(app.getHttpServer())
        .post(`/channels/${VALID_CHANNEL_ID}/register`)
        .expect(500);
    });

    it('should return result with errors', async () => {
      const mockResponse: RegisterChannelResult = {
        channelId: VALID_CHANNEL_ID,
        channelName: 'Test Channel',
        processedCount: 5,
        successCount: 3,
        failedCount: 2,
        skippedCount: 0,
        skippedShortsCount: 0,
        skippedPermanentlyFailedCount: 0,
        errors: ['Video ABC failed', 'Video XYZ failed'],
        failedVideos: [],
      };

      mockRegisterChannelUseCase.execute.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .post(`/channels/${VALID_CHANNEL_ID}/register`)
        .expect(201);

      expect(response.body.errors).toHaveLength(2);
    });
  });

  describe('POST /channels/:channelId/register-all', () => {
    it('should register all videos for channel', async () => {
      const mockResponse: RegisterChannelVideosResult = {
        channelId: VALID_CHANNEL_ID,
        channelName: 'Test Channel',
        totalVideos: 50,
        processedCount: 50,
        successCount: 45,
        failedCount: 5,
        skippedCount: 0,
        skippedShortsCount: 0,
        errors: [],
      };

      mockRegisterChannelVideosUseCase.execute.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .post(`/channels/${VALID_CHANNEL_ID}/register-all`)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(mockRegisterChannelVideosUseCase.execute).toHaveBeenCalledWith({
        channelId: VALID_CHANNEL_ID,
        maxVideos: 100,
      });
    });

    it('should accept custom max videos parameter', async () => {
      const mockResponse: RegisterChannelVideosResult = {
        channelId: VALID_CHANNEL_ID,
        channelName: 'Test Channel',
        totalVideos: 25,
        processedCount: 25,
        successCount: 20,
        failedCount: 5,
        skippedCount: 0,
        skippedShortsCount: 0,
        errors: [],
      };

      mockRegisterChannelVideosUseCase.execute.mockResolvedValue(mockResponse);

      await request(app.getHttpServer())
        .post(`/channels/${VALID_CHANNEL_ID}/register-all?max=25`)
        .expect(201);

      expect(mockRegisterChannelVideosUseCase.execute).toHaveBeenCalledWith({
        channelId: VALID_CHANNEL_ID,
        maxVideos: 25,
      });
    });
  });
});
