import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { VideosController } from '@/presentation/http/controllers/videos.controller';
import { RegisterVideoUseCase, RegisterVideoResult } from '@/application/use-cases';

describe('VideosController (e2e)', () => {
  let app: INestApplication;
  let mockRegisterVideoUseCase: jest.Mocked<RegisterVideoUseCase>;

  const VALID_VIDEO_ID = 'dQw4w9WgXcQ';

  beforeEach(async () => {
    mockRegisterVideoUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RegisterVideoUseCase>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [
        {
          provide: RegisterVideoUseCase,
          useValue: mockRegisterVideoUseCase,
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

  describe('POST /videos/:videoId/register', () => {
    it('should register video successfully', async () => {
      const mockResponse: RegisterVideoResult = {
        success: true,
        message: 'Video registered successfully',
        data: {
          videoId: VALID_VIDEO_ID,
          youtubeTitle: 'Test Video Title',
          tmdbTitle: 'Test Movie',
          tmdbType: 'movie',
          tmdbId: 12345,
          includesEnding: false,
          contentId: 12345,
        },
      };

      mockRegisterVideoUseCase.execute.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .post(`/videos/${VALID_VIDEO_ID}/register`)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(mockRegisterVideoUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: VALID_VIDEO_ID }),
      );
    });

    it('should return error for invalid video ID format', async () => {
      await request(app.getHttpServer())
        .post('/videos/invalid/register')
        .expect(400);
    });

    it('should handle use case errors', async () => {
      mockRegisterVideoUseCase.execute.mockRejectedValue(
        new Error('Video not found'),
      );

      await request(app.getHttpServer())
        .post(`/videos/${VALID_VIDEO_ID}/register`)
        .expect(500);
    });

    it('should return failure result for unmatched video', async () => {
      const mockResponse: RegisterVideoResult = {
        success: false,
        message: 'No TMDB match found',
      };

      mockRegisterVideoUseCase.execute.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .post(`/videos/${VALID_VIDEO_ID}/register`)
        .expect(201);

      expect(response.body.success).toBe(false);
    });
  });
});
