import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { BatchController } from '@/presentation/http/controllers/batch.controller';
import { BatchProcessingService } from '@/application/services';
import { BatchProcessResult } from '@/application/use-cases';

describe('BatchController (e2e)', () => {
  let app: INestApplication;
  let mockBatchProcessingService: jest.Mocked<BatchProcessingService>;

  beforeEach(async () => {
    mockBatchProcessingService = {
      getStatus: jest.fn(),
      isRunning: jest.fn(),
      runBatch: jest.fn(),
    } as unknown as jest.Mocked<BatchProcessingService>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        {
          provide: BatchProcessingService,
          useValue: mockBatchProcessingService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /batch/status', () => {
    it('should return batch status', async () => {
      const mockStatus = {
        lastRunAt: new Date('2024-01-01T00:00:00.000Z'),
        isRunning: false,
        processedChannels: 5,
        processedVideos: 50,
        newVideosFound: 10,
        errors: [],
      };

      mockBatchProcessingService.getStatus.mockReturnValue(mockStatus);

      const response = await request(app.getHttpServer())
        .get('/batch/status')
        .expect(200);

      expect(response.body).toEqual({
        lastRunAt: '2024-01-01T00:00:00.000Z',
        isRunning: false,
        processedChannels: 5,
        processedVideos: 50,
        newVideosFound: 10,
        errors: [],
      });
    });

    it('should handle null lastRunAt', async () => {
      const mockStatus = {
        lastRunAt: null,
        isRunning: false,
        processedChannels: 0,
        processedVideos: 0,
        newVideosFound: 0,
        errors: [],
      };

      mockBatchProcessingService.getStatus.mockReturnValue(mockStatus);

      const response = await request(app.getHttpServer())
        .get('/batch/status')
        .expect(200);

      expect(response.body.lastRunAt).toBeNull();
    });

    it('should show running status', async () => {
      const mockStatus = {
        lastRunAt: new Date('2024-01-01T00:00:00.000Z'),
        isRunning: true,
        processedChannels: 2,
        processedVideos: 20,
        newVideosFound: 5,
        errors: [],
      };

      mockBatchProcessingService.getStatus.mockReturnValue(mockStatus);

      const response = await request(app.getHttpServer())
        .get('/batch/status')
        .expect(200);

      expect(response.body.isRunning).toBe(true);
    });
  });

  describe('POST /batch/run', () => {
    it('should run batch successfully', async () => {
      const mockResult: BatchProcessResult = {
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
        completedAt: new Date('2024-01-01T00:05:00.000Z'),
        totalChannels: 5,
        totalVideosProcessed: 50,
        totalSuccess: 45,
        totalFailed: 5,
        totalSkippedShorts: 3,
        channelResults: [],
        errors: [],
      };

      mockBatchProcessingService.isRunning.mockReturnValue(false);
      mockBatchProcessingService.runBatch.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .post('/batch/run')
        .expect(201);

      expect(response.body).toEqual({
        startedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-01-01T00:05:00.000Z',
        totalChannels: 5,
        totalVideosProcessed: 50,
        totalSuccess: 45,
        totalFailed: 5,
        channelResults: [],
        errors: [],
      });
    });

    it('should return conflict when batch is already running', async () => {
      mockBatchProcessingService.isRunning.mockReturnValue(true);

      await request(app.getHttpServer())
        .post('/batch/run')
        .expect(HttpStatus.CONFLICT);
    });

    it('should handle batch errors', async () => {
      mockBatchProcessingService.isRunning.mockReturnValue(false);
      mockBatchProcessingService.runBatch.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await request(app.getHttpServer())
        .post('/batch/run')
        .expect(500);
    });
  });
});
