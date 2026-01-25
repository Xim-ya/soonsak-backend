import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SchedulerService } from '../services/scheduler.service';

/**
 * Scheduler Controller
 * Provides API endpoints for scheduler operations
 */
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * Get scheduler status
   */
  @Get('status')
  getStatus() {
    return this.schedulerService.getStatus();
  }

  /**
   * Trigger full batch processing
   */
  @Post('trigger')
  async triggerBatch() {
    return this.schedulerService.runBatch();
  }

  /**
   * Process a specific channel
   */
  @Post('channel/:id')
  async processChannel(@Param('id') channelId: string) {
    return this.schedulerService.processChannel(channelId);
  }

  /**
   * Process a single video
   */
  @Post('video/:id')
  async processVideo(@Param('id') videoId: string) {
    return this.schedulerService.processSingleVideo(videoId);
  }
}
