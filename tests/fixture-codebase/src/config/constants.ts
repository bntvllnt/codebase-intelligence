export const API_VERSION = "v1";

export const MAX_PAGE_SIZE = 100;

export type SortOrder = "asc" | "desc";

export interface PaginationOptions {
  page: number;
  pageSize: number;
  sort?: SortOrder;
}

export const DEFAULT_PAGINATION: PaginationOptions = {
  page: 1,
  pageSize: 20,
  sort: "asc",
};
