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
  "              parent_folder {",
  "                id",
  "              }",
  "              zip_file {",
  "                id",
  "              }",
  "            }",
  "            ... on VideoFile {",
  "              id",
  "              path",
  "            }",
  "          }",
];

/**
 * The reader's selection: the page needs a name, a URL and the files.
 *
 * `visual_files` is the whole point — an image's occurrences live there — and the
 * file id, folder and zip are what map one to this gallery.
 */
const LIGHT_IMAGE_FIELDS = [
  "          id",
  "          title",
  "          paths {",
  "            image",
  "            thumbnail",
  "            preview",
  "          }",
  "          visual_files {",
  "            __typename",
  "            ... on ImageFile {",
  "              id",
  "              path",
  "              width",
  "              height",
  "              parent_folder {",
  "                id",
  "              }",
  "              zip_file {",
  "                id",
  "              }",
  "            }",
  "            ... on VideoFile {",
  "              id",
  "              path",
  "            }",
  "          }",
];

function imagesQueryText(withImages: boolean): string {
  return [
    "query MangaToolsGalleryFiles($galleryId: ID!, $perPage: Int!) {",
    "  findImages(",
    "    image_filter: { galleries: { value: [$galleryId], modifier: INCLUDES } }",
    "    filter: { per_page: $perPage }",
    "  ) {",
    "    images {",
    ...(withImages ? IMAGE_SLIM_FIELDS : LIGHT_IMAGE_FIELDS),
    "    }",
    "  }",
    "}",
  ].join("\n");
}

/**
 * The gallery's images with their files.
 *
 * **Not `findFiles`.** The first version asked `findFiles` for the files and read
 * `ImageFile.images` to get back to the image — and the Stash this plugin runs
 * against does not have that field, so the whole query was rejected and the grid
 * silently kept its deduplicated list. `Image.visual_files` is the direction the
 * schema does support, and it carries each file's folder and zip, which is
 * everything the scope test needs.
 */
export const GALLERY_FILES_QUERY_TEXT = imagesQueryText(false);

/** The same, with the grid's card fields on each image. */
export const GALLERY_FILES_WITH_IMAGES_QUERY_TEXT = imagesQueryText(true);

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

/** The files of a gallery, in the gallery's own path order. */
export interface GalleryFileList {
  files: GalleryFileEntry[];
  /**
   * The physical pages — `files.length`.
   *
   * Video files are not pages (a page is a file of an Image), so this is the count
   * of what the reader will walk. Revalidation asks the server for its own count,
   * which includes a video; a gallery that had one would re-read on every opening
   * rather than miss a change, which is the safe direction.
   */
  total: number;
}

/**
 * A gallery's files, in the order Stash's own path sort would put them.
 *
 * **Reads the images and expands `visual_files`.** The first version asked
 * `findFiles` and read `ImageFile.images` — a field this plugin's Stash does not
 * have, so the query was rejected and the grid silently kept its deduplicated
 * list. `Image.visual_files` is the direction the schema does support, and each
 * file carries its parent folder and zip file, which is all the scope test needs.
 *
 * A file belongs to the gallery when its parent folder is the gallery's folder, or
 * its zip file is the gallery's zip file — the scanner's own association rule.
 *
 * **The order is the basenames.** Every file in one gallery shares its folder or
 * its zip, so Stash's `COLLATE NATURAL_CI` on `folder || basename` reduces to the
 * basename; `Intl.Collator` with `numeric` compares the digit runs (`001`, `002`,
 * `040`, `229`) the same way. Rebuilding SQLite's collation for arbitrary text
 * would be a second, approximate implementation of it.
 */
export async function fetchGalleryFiles(
  galleryId: string,
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

  const data = (await requirePluginApi()
    .utils.StashService.getClient()
    .query({
      query,
      variables: { galleryId, perPage: -1 },
      fetchPolicy: "no-cache",
    })
    .then((res) => res?.data)) as
    | {
        findImages?: {
          images?: Array<{
            id?: string | number;
            title?: string | null;
            paths?: {
              image?: string;
              thumbnail?: string;
              preview?: string;
            } | null;
            visual_files?: Array<{
              __typename?: string;
              id?: string | number;
              path?: string;
              width?: number;
              height?: number;
              parent_folder?: { id?: string | number } | null;
              zip_file?: { id?: string | number } | null;
            }>;
          }>;
        };
      }
    | undefined;

  const entries: GalleryFileEntry[] = [];

  for (const image of data?.findImages?.images || []) {
    const imageId = image.id ? String(image.id) : "";
    if (!imageId) continue;

    for (const file of image.visual_files || []) {
      if (file.__typename !== "ImageFile") continue;

      const parentFolderId = file.parent_folder?.id
        ? String(file.parent_folder.id)
        : null;
      const zipFileId = file.zip_file?.id ? String(file.zip_file.id) : null;

      if (scope.zipFileId && zipFileId !== scope.zipFileId) continue;
      if (scope.folderId && parentFolderId !== scope.folderId) continue;

      const path = String(file.path || "");

      entries.push({
        fileId: String(file.id),
        imageId,
        path,
        basename: path.slice(path.lastIndexOf("/") + 1),
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
  }

  entries.sort(byPath);

  return { files: entries, total: entries.length };
}

/** Case-insensitive, digit-run aware: the part of `NATURAL_CI` that matters. */
const basenameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function byPath(a: GalleryFileEntry, b: GalleryFileEntry): number {
  const byName = basenameCollator.compare(a.basename, b.basename);
  if (byName !== 0) return byName;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
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
