export const defaultCoverIds = [10, 11, 12, 15, 16, 17, 18, 19];

/** Program-owned photos keep their original URL; small displays use fixed derivatives. */
export function defaultCoverVariants(src: string) {
  const match = /^\/default-covers\/picsum-(\d+)\.webp$/.exec(src);
  if (!match || !defaultCoverIds.includes(Number(match[1]))) return null;
  return [240, 480, 1200].map(width => ({
    width, height: width * 9 / 16,
    url: width === 1200 ? src : `/default-covers/thumbs/picsum-${match[1]}-${width}.webp`,
  }));
}
