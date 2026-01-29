import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import {
  IHomeSectionGeneratorPort,
  ContentMetadataForSection,
  HomeSectionGenerationResult,
  GeneratedSection,
} from '@/application/ports';
import {
  buildHomeSectionGenerationPrompt,
  generateFallbackSections,
} from './prompts';

/**
 * OpenAI 홈 섹션 생성 어댑터
 * AI 기반 테마별 섹션 자동 생성
 */
@Injectable()
export class OpenAIHomeSectionAdapter implements IHomeSectionGeneratorPort {
  private readonly logger = new Logger(OpenAIHomeSectionAdapter.name);
  private openai: OpenAI | null = null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        'OPENAI_API_KEY not configured - will use fallback section generation',
      );
    }
  }

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }
    return this.openai;
  }

  async generateSections(
    contents: ContentMetadataForSection[],
    sectionCount: number = 5,
    itemsPerSection: number = 10,
  ): Promise<HomeSectionGenerationResult> {
    if (contents.length === 0) {
      this.logger.warn('No contents provided for section generation');
      return { sections: [], generatedAt: new Date() };
    }

    // OpenAI 미설정 시 폴백
    if (!this.openai) {
      this.logger.log('Using fallback section generation (no OpenAI key)');
      return this.generateFallbackResult(contents);
    }

    const prompt = buildHomeSectionGenerationPrompt(
      contents,
      sectionCount,
      itemsPerSection,
    );

    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              '당신은 OTT 플랫폼의 콘텐츠 큐레이터입니다. 창의적이고 매력적인 섹션 제목을 만들어 사용자의 관심을 끌어주세요.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const result = response.choices[0]?.message?.content || '';
      const parsed = this.parseAIResponse(result, contents);

      if (parsed.sections.length > 0) {
        this.logger.log(`Generated ${parsed.sections.length} sections via AI`);
        return parsed;
      }

      // 파싱 실패 시 폴백
      this.logger.warn('Failed to parse AI response, using fallback');
      return this.generateFallbackResult(contents);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(`AI section generation failed: ${errorMessage}`);

      // 1회 재시도
      try {
        this.logger.log('Retrying AI section generation...');
        const retryResponse = await this.getOpenAI().chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                '당신은 OTT 플랫폼의 콘텐츠 큐레이터입니다. JSON 형식으로만 응답해주세요.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 2000,
        });

        const retryResult = retryResponse.choices[0]?.message?.content || '';
        const retryParsed = this.parseAIResponse(retryResult, contents);

        if (retryParsed.sections.length > 0) {
          this.logger.log(
            `Retry successful: Generated ${retryParsed.sections.length} sections`,
          );
          return retryParsed;
        }
      } catch (retryError) {
        this.logger.error(
          `Retry also failed: ${(retryError as Error).message}`,
        );
      }

      // 재시도도 실패하면 폴백
      return this.generateFallbackResult(contents);
    }
  }

  private parseAIResponse(
    aiResponse: string,
    contents: ContentMetadataForSection[],
  ): HomeSectionGenerationResult {
    try {
      const jsonMatch = aiResponse.trim().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { sections: [], generatedAt: new Date() };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.sections || !Array.isArray(parsed.sections)) {
        return { sections: [], generatedAt: new Date() };
      }

      // 유효한 콘텐츠 ID 세트
      const validContentIds = new Set(contents.map((c) => c.id));

      const sections: GeneratedSection[] = parsed.sections
        .map((section: any) => {
          // 콘텐츠 ID 유효성 검증
          const validContentIds_ = (section.content_ids || [])
            .filter(
              (item: any) =>
                item &&
                typeof item.id === 'number' &&
                validContentIds.has(item.id) &&
                (item.type === 'movie' || item.type === 'tv'),
            )
            .map((item: any) => ({
              contentId: item.id,
              contentType: item.type as 'movie' | 'tv',
            }));

          // 최소 4개 이상의 콘텐츠가 있어야 유효한 섹션
          if (validContentIds_.length < 4) {
            return null;
          }

          return {
            title: section.title || '추천 콘텐츠',
            subtitle: section.subtitle,
            themeKeywords: section.theme_keywords || [],
            contentIds: validContentIds_,
            reasoning: section.reasoning || 'AI 큐레이션',
          };
        })
        .filter((s: GeneratedSection | null): s is GeneratedSection => s !== null);

      return {
        sections,
        generatedAt: new Date(),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to parse AI response: ${(error as Error).message}`,
      );
      return { sections: [], generatedAt: new Date() };
    }
  }

  private generateFallbackResult(
    contents: ContentMetadataForSection[],
  ): HomeSectionGenerationResult {
    const sections = generateFallbackSections(contents);
    this.logger.log(`Generated ${sections.length} fallback sections`);
    return {
      sections,
      generatedAt: new Date(),
    };
  }
}
