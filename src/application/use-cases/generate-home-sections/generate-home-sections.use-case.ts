import { Injectable, Logger, Inject } from '@nestjs/common';
import { INJECTION_TOKENS } from '@/shared/constants';
import { HomeSection, SectionContentRef } from '@/domain/entities';
import { IHomeSectionRepository } from '@/domain/repositories';
import {
  IHomeSectionGeneratorPort,
  ContentMetadataForSection,
} from '@/application/ports';
import { SupabaseClientProvider } from '@/infrastructure/persistence/supabase/supabase-client.provider';
import {
  GenerateHomeSectionsInput,
  GenerateHomeSectionsOutput,
} from './generate-home-sections.dto';

/**
 * 홈 섹션 생성 유즈케이스
 * AI 기반으로 테마별 홈 섹션을 자동 생성
 */
@Injectable()
export class GenerateHomeSectionsUseCase {
  private readonly logger = new Logger(GenerateHomeSectionsUseCase.name);

  constructor(
    @Inject(INJECTION_TOKENS.HOME_SECTION_REPOSITORY)
    private readonly homeSectionRepository: IHomeSectionRepository,
    @Inject(INJECTION_TOKENS.HOME_SECTION_GENERATOR)
    private readonly homeSectionGenerator: IHomeSectionGeneratorPort,
    private readonly supabaseProvider: SupabaseClientProvider,
  ) {}

  async execute(
    input: GenerateHomeSectionsInput = {},
  ): Promise<GenerateHomeSectionsOutput> {
    const {
      sectionCount = 5,
      itemsPerSection = 10,
      forceRegenerate = false,
    } = input;

    this.logger.log(
      `Starting home section generation (sectionCount=${sectionCount}, itemsPerSection=${itemsPerSection}, forceRegenerate=${forceRegenerate})`,
    );

    // 1. 강제 재생성이 아니면 기존 활성 섹션 확인
    if (!forceRegenerate) {
      const existingSections = await this.homeSectionRepository.findAllActive();
      if (existingSections.length > 0 && existingSections.every((s) => s.isValid())) {
        this.logger.log(
          `Found ${existingSections.length} valid active sections, skipping regeneration`,
        );
        return {
          success: true,
          sectionCount: existingSections.length,
          sectionIds: existingSections.map((s) => s.id!),
          sections: existingSections.map((s) => ({
            title: s.title,
            contentCount: s.contentIds.length,
          })),
          generatedAt: existingSections[0].generatedAt || new Date(),
          message: '기존 활성 섹션이 유효합니다.',
        };
      }
    }

    // 2. 전체 콘텐츠 메타데이터 조회
    const contents = await this.fetchAllContents();
    if (contents.length === 0) {
      this.logger.warn('No contents found for section generation');
      return {
        success: false,
        sectionCount: 0,
        sectionIds: [],
        sections: [],
        generatedAt: new Date(),
        message: '콘텐츠가 없어 섹션을 생성할 수 없습니다.',
      };
    }

    this.logger.log(`Found ${contents.length} contents for analysis`);

    // 3. 이전 섹션 정보 조회 (중복 방지용)
    const previousSections = await this.homeSectionRepository.findPreviousSections(30);
    this.logger.log(`Found ${previousSections.length} previous sections for deduplication`);

    // 4. AI 기반 섹션 생성
    const generationResult = await this.homeSectionGenerator.generateSections(
      contents,
      sectionCount,
      itemsPerSection,
      previousSections,
    );

    if (generationResult.sections.length === 0) {
      this.logger.error('Failed to generate any sections');
      return {
        success: false,
        sectionCount: 0,
        sectionIds: [],
        sections: [],
        generatedAt: new Date(),
        message: '섹션 생성에 실패했습니다.',
      };
    }

    // 5. HomeSection 엔티티 생성
    const now = new Date();

    const homeSections = generationResult.sections.map((section, index) => {
      const contentIds: SectionContentRef[] = section.contentIds.map((content) => ({
        id: content.contentId,
        type: content.contentType,
      }));

      return HomeSection.create({
        title: section.title,
        subtitle: section.subtitle,
        themeKeywords: section.themeKeywords,
        contentIds,
        displayOrder: index + 1,
        aiReasoning: section.reasoning,
      });
    });

    // 6. DB 저장 (기존 섹션 비활성화 후 저장)
    const savedIds = await this.homeSectionRepository.saveAll(homeSections);

    this.logger.log(
      `Successfully generated and saved ${savedIds.length} home sections`,
    );

    return {
      success: true,
      sectionCount: savedIds.length,
      sectionIds: savedIds,
      sections: homeSections.map((s) => ({
        title: s.title,
        contentCount: s.contentIds.length,
      })),
      generatedAt: now,
      message: `${savedIds.length}개의 홈 섹션이 생성되었습니다.`,
    };
  }

  /**
   * 전체 콘텐츠 메타데이터 조회
   */
  private async fetchAllContents(): Promise<ContentMetadataForSection[]> {
    const { data, error } = await this.supabaseProvider
      .getClient()
      .from('contents')
      .select(`
        id, content_type, title, genre_ids, tagline, overview,
        original_language, release_date,
        vote_average, popularity, origin_country, directors, main_cast
      `)
      .order('uploaded_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch contents: ${error.message}`);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      contentType: row.content_type as 'movie' | 'tv',
      title: row.title,
      genreIds: row.genre_ids,
      tagline: row.tagline,
      overview: row.overview,
      originalLanguage: row.original_language,
      releaseDate: row.release_date,
      voteAverage: row.vote_average,
      popularity: row.popularity,
      originCountry: row.origin_country,
      directors: row.directors,
      mainCast: row.main_cast,
    }));
  }
}
