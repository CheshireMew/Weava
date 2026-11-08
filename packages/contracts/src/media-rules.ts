/** Rules shared by upload clients, storage indexes and renderers. SVG can be
 * displayed from existing content, but is deliberately not an upload format. */
export const mediaUploadMaxBytes = 32 * 1024 * 1024;
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const videoExtensions = new Set(['.mp4', '.webm']);
const audioExtensions = new Set(['.mp3']);
const documentExtensions = new Set(['.pdf', '.txt', '.csv', '.vtt', '.srt']);
export type MediaKind = 'image' | 'video' | 'audio' | 'file';
const extension = (name: string) => /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? '';

export function mediaKind(name: string): MediaKind {
  const ext = extension(name);
  return imageExtensions.has(ext) || ext === '.svg'
    ? 'image'
    : videoExtensions.has(ext)
      ? 'video'
      : audioExtensions.has(ext)
        ? 'audio'
        : 'file';
}
export function isUploadFormat(name: string, imagesOnly = false): boolean {
  const ext = extension(name);
  return (
    imageExtensions.has(ext) ||
    (!imagesOnly &&
      (videoExtensions.has(ext) || audioExtensions.has(ext) || documentExtensions.has(ext)))
  );
}
