/**
 * 统一的数据模型层
 * 对应 confluence-cli 的 internal/apiclient/models.go
 */

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface NoteRef {
  id: string;
  title: string;
}

export interface ListResult<T> {
  items: T[];
  next?: string;
  hasMore: boolean;
}

export interface CreateNoteReq {
  title: string;
  content: string;
  tags?: string[];
}

export interface UpdateNoteReq {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
}

export interface SearchHit {
  id: string;
  title: string;
  excerpt: string;
}

export interface WriteRequestPlan {
  method: string;
  url: string;
  payload?: unknown;
}
