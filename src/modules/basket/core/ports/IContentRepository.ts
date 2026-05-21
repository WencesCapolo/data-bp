import type { ContentProps } from '@basket/core/entities/Content';

export interface IContentRepository {
  upsertMany(content: ContentProps[]): Promise<number>;
  count(): Promise<number>;
}
