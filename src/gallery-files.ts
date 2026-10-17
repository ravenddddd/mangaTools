/**
 * A gallery's physical files — the list a gallery is read by when "physical pages"
 * is on.
 *
 * **Stash deduplicates content.** The same bytes at two paths are one Image with two
 * files (`images_files`, exactly one of them `primary`), and a gallery's image list
 * is `SELECT DISTINCT images.id`. So a page that appears four times in one archive is
 * listed once, and the other three occurrences have no place in that list. This
 * module asks the other question — *which files are in this gallery* — and each file
 * is one occurrence, with its own id and path.
 *
 * The scope is the association the scanner itself uses (`pkg/image/scan.go`,
 * `getOrCreateFolderBasedGallery` / `getOrCreateZipBasedGallery`):
 *
 *   - a folder gallery holds the files whose **parent folder** is the gallery's folder
 *   - a zip gallery holds the files whose **zip file** is the gallery's zip file
 *
 * Both are exposed on `Gallery` (`folder`, `files`), and the file filters take the
 * same ids. A gallery with neither (a manually created one) has no physical list, and
 * the caller keeps the deduped one.
 *
 * **The order is the server's.** `findFiles` sorts by path with Stash's own
 * `NATURAL_CI` collation, which is what its lightbox and chapter numbers count in.
 * Re-implementing that collation in JavaScript would be a second, approximate answer
 * to a question the server has already answered exactly.
 *
 * Module level, like languages.ts: both halves need this and neither may import the
 * other. See core.ts for the down-never-sideways rule.
 */
import { gqlDoc, requirePluginApi } from "./plugin-api";

/** Which association makes a file part of a gallery — see the note above. */
export interface GalleryFileScope {
  folderId: string | null;
  zipFileId: string | null;
}

/** One physical file in a gallery, with the image it belongs to. */
export interface GalleryFileEntry {
  /** The file id — unique per occurrence, and the page identity in this mode. */
  fileId: string;
  /** The deduplicated Image this file belongs to. */
  imageId: string;
  /** The file's full path, as Stash holds it. */
  path: string;
  /** The file's name, which is what a page with no title is called. */
  basename: string;
  width: number;
  height: number;
  /** The image's title, or "" — the page's own name when it has one. */
  title: string;
  /** Stash's image URL, query and all. Its bytes are the same for every occurrence. */
  imageUrl: string;
  /** The image's thumbnail and preview URLs, for the grid. */
  thumbnail: string;
  preview: string;
  parentFolderId: string | null;
  zipFileId: string | null;
  /**
   * The image as the grid's own fragment wants it, when that was asked for.
   *
   * A clone of this object, with the id and file replaced, is what the grid's
   * cards render: the card draws tags, performers, the date and the popovers, and
   * losing them because the row is a file occurrence would be a visible
   * regression. Absent in the reader's plain query.
   */
  image?: Record<string, unknown>;
}

export const GALLERY_SCOPE_QUERY_TEXT = [
  "query MangaToolsGalleryScope($id: ID!) {",
  "  findGallery(id: $id) {",
  "    id",
  "    folder {",
  "      id",
  "    }",
  "    files {",
  "      id",
  "    }",
  "  }",
  "}",
].join("\n");

/**
 * The image selection the grid's cards need, when the caller wants it.
 *
 * The same shape Stash's own list asks for, and the same reason: the card draws
 * tags, performers, the gallery popover, the studio overlay and the date, and a
 * card built from an id and a path alone would quietly lose all of it. Only the
 * grid asks for this — the reader needs a title and a URL — so the plain query
 * below keeps the cheap selection.
 */
const IMAGE_SLIM_FIELDS = [
  "          id",
  "          title",
  "          code",
  "          date",
  "          urls",
  "          details",
  "          photographer",
  "          rating100",
  "          organized",
  "          o_counter",
  "          paths {",
  "            thumbnail",
  "            preview",
  "            image",
  "          }",
  "          galleries {",
  "            id",
  "            title",
  "            folder {",
  "              path",
  "            }",
  "          }",
  "          studio {",
  "            id",
  "            name",
  "            image_path",
  "          }",
  "          tags {",
  "            id",
  "            name",
  "          }",
  "          performers {",
  "            id",
  "            name",
  "            gender",
  "            favorite",
  "            image_path",
  "          }",
  "          visual_files {",
  "            __typename",
  "            ... on ImageFile {",
  "              id",
  "              path",
  "              width",
  "              height",
  "            }",
  "            ... on VideoFile {",
  "              id",
  "              path",
  "            }",
  "          }",
];

const LIGHT_IMAGE_FIELDS = [
  "          id",
  "          title",
  "          paths {",
  "            image",
  "            thumbnail",
  "            preview",
  "          }",
];

function filesQueryText(withImages: boolean): string {
  return [
    "query MangaToolsGalleryFiles($fileFilter: FileFilterType, $perPage: Int!) {",
    "  findFiles(",
    "    file_filter: $fileFilter",
    '    filter: { per_page: $perPage, sort: "path", direction: ASC }',
    "  ) {",
    "    count",
    "    files {",
    "      __typename",
    "      ... on ImageFile {",
    "        id",
    "        path",
    "        basename",
    "        width",
    "        height",
    "        parent_folder {",
    "          id",
    "        }",
    "        zip_file {",
    "          id",
    "        }",
    "        images {",
    ...(withImages ? IMAGE_SLIM_FIELDS : LIGHT_IMAGE_FIELDS),
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}

/** The plain file list — ids, paths, and just enough image for a page. */
export const GALLERY_FILES_QUERY_TEXT = filesQueryText(false);

/** The same list with the grid's card fields on each image. */
export const GALLERY_FILES_WITH_IMAGES_QUERY_TEXT = filesQueryText(true);

export const GALLERY_FILE_COUNT_QUERY_TEXT = [
  "query MangaToolsGalleryFileCount($fileFilter: FileFilterType) {",
  "  findFiles(file_filter: $fileFilter, filter: { per_page: 1 }) {",
  "    count",
  "  }",
  "}",
].join("\n");

let scopeQuery: unknown = null;
let filesQuery: unknown = null;
let filesWithImagesQuery: unknown = null;
let countQueryDoc: unknown = null;

/**
 * The folder or zip file a gallery's membership is built from, or null when it has
 * neither (and so no physical list).
 */
export async function fetchGalleryScope(
  galleryId: string
): Promise<GalleryFileScope | null> {
  if (!scopeQuery) {
    scopeQuery = gqlDoc(
      GALLERY_SCOPE_QUERY_TEXT,
      "build the gallery scope query"
    );
  }
  const query = scopeQuery;
  if (!query) return null;

  const data = (await requirePluginApi()
    .utils.StashService.getClient()
    // no-cache, as every query outside the tools half's store: this is read once
    // per opening and nothing else in the page wants it in Apollo's cache.
    .query({
      query,
      variables: { id: galleryId },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data)) as
    | {
        findGallery?: {
          folder?: { id?: string | number } | null;
          files?: { id?: string | number }[];
        } | null;
      }
    | undefined;

  const gallery = data?.findGallery;
  if (!gallery) return null;

  return {
    folderId: gallery.folder?.id ? String(gallery.folder.id) : null,
    zipFileId: gallery.files?.[0]?.id ? String(gallery.files[0].id) : null,
  };
}

/** The files of a gallery, and the server's count of everything in its scope. */
export interface GalleryFileList {
  files: GalleryFileEntry[];
  /**
   * Every file in the gallery's scope, video files included — what the server
   * counted. The reader keeps it for revalidation, where it is the cheapest exact
   * answer to "has this gallery changed at all" (see revalidate in takeover.ts).
   */
  total: number;
}

/**
 * A gallery's files, in path order, or an empty list when it has no physical scope.
 *
 * Video files are dropped from `files`: a file is a page only when it belongs to an
 * Image (`ImageFile.images`), which is the same set the deduped list is made of. A
 * video sitting in a gallery's folder is not a gallery page in Stash's own model
 * either. `total` still counts it, so a membership change of any kind is noticed.
 */
export async function fetchGalleryFiles(
  scope: GalleryFileScope,
  withImages = false
): Promise<GalleryFileList> {
  if (!scope.folderId && !scope.zipFileId) return { files: [], total: 0 };

  if (withImages && !filesWithImagesQuery) {
    filesWithImagesQuery = gqlDoc(
      GALLERY_FILES_WITH_IMAGES_QUERY_TEXT,
      "build the gallery files with images query"
    );
  }
  if (!withImages && !filesQuery) {
    filesQuery = gqlDoc(
      GALLERY_FILES_QUERY_TEXT,
      "build the gallery files query"
    );
  }
  const query = withImages ? filesWithImagesQuery : filesQuery;
  if (!query) return { files: [], total: 0 };

  const fileFilter = scope.zipFileId
    ? { zip_file: { value: [scope.zipFileId], modifier: "INCLUDES" } }
    : { parent_folder: { value: [scope.folderId], modifier: "INCLUDES" } };

  const data = (await requirePluginApi()
    .utils.StashService.getClient()
    .query({
      query,
      variables: { fileFilter, perPage: -1 },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data)) as
    | {
        findFiles?: {
          count?: number;
          files?: Array<{
            __typename?: string;
            id?: string | number;
            path?: string;
            basename?: string;
            width?: number;
            height?: number;
            parent_folder?: { id?: string | number } | null;
            zip_file?: { id?: string | number } | null;
            images?: Array<{
              id?: string | number;
              title?: string | null;
              paths?: {
                image?: string;
                thumbnail?: string;
                preview?: string;
              } | null;
            }>;
          }>;
        };
      }
    | undefined;

  const entries: GalleryFileEntry[] = [];

  for (const file of data?.findFiles?.files || []) {
    if (file.__typename !== "ImageFile") continue;

    const image = file.images?.[0];
    if (!image?.id) continue;

    const parentFolderId = file.parent_folder?.id
      ? String(file.parent_folder.id)
      : null;
    const zipFileId = file.zip_file?.id ? String(file.zip_file.id) : null;

    // The filter already scopes this; the exact test keeps a hierarchical
    // parent-folder filter from pulling in subfolders the scanner never associated.
    if (scope.zipFileId && zipFileId !== scope.zipFileId) continue;
    if (scope.folderId && parentFolderId !== scope.folderId) continue;

    entries.push({
      fileId: String(file.id),
      imageId: String(image.id),
      path: String(file.path || ""),
      basename: String(file.basename || ""),
      width: typeof file.width === "number" ? file.width : 0,
      height: typeof file.height === "number" ? file.height : 0,
      title: String(image.title || ""),
      imageUrl: String(image.paths?.image || ""),
      thumbnail: String(image.paths?.thumbnail || ""),
      preview: String(image.paths?.preview || ""),
      parentFolderId,
      zipFileId,
      image: withImages ? (image as Record<string, unknown>) : undefined,
    });
  }

  return {
    files: entries,
    total:
      typeof data?.findFiles?.count === "number"
        ? data.findFiles.count
        : entries.length,
  };
}

/**
 * How many files the gallery holds now, or null when the server did not say.
 *
 * The same filter as the list, counted rather than fetched: a membership change is
 * noticed without paying for the list again. See revalidate in takeover.ts.
 */
export async function fetchGalleryFileCount(
  scope: GalleryFileScope
): Promise<number | null> {
  if (!scope.folderId && !scope.zipFileId) return 0;

  if (!countQueryDoc) {
    countQueryDoc = gqlDoc(
      GALLERY_FILE_COUNT_QUERY_TEXT,
      "build the gallery file count query"
    );
  }
  const query = countQueryDoc;
  if (!query) return null;

  const fileFilter = scope.zipFileId
    ? { zip_file: { value: [scope.zipFileId], modifier: "INCLUDES" } }
    : { parent_folder: { value: [scope.folderId], modifier: "INCLUDES" } };

  const data = (await requirePluginApi()
    .utils.StashService.getClient()
    .query({
      query,
      variables: { fileFilter },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data)) as
    | { findFiles?: { count?: number } }
    | undefined;

  const count = data?.findFiles?.count;
  return typeof count === "number" ? count : null;
}

/** The first occurrence of each image, in the order the files came in. */
export function firstFileByImage(
  entries: GalleryFileEntry[]
): Map<string, GalleryFileEntry> {
  const first = new Map<string, GalleryFileEntry>();

  entries.forEach((entry) => {
    if (!first.has(entry.imageId)) first.set(entry.imageId, entry);
  });

  return first;
}
