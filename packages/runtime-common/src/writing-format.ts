/** Portable writing styles shared by the editor, Markdown and published pages. */
export const textColors = {
  accent: {label: '主题色', value: '#d63d0b'},
  red: {label: '红色', value: '#b42318'},
  blue: {label: '蓝色', value: '#175cd3'},
  green: {label: '绿色', value: '#027a48'},
  muted: {label: '灰色', value: '#667085'},
} as const;
export const highlightColors = {
  yellow: {label: '黄色', value: '#fff0a8'},
  green: {label: '绿色', value: '#d5f2d1'},
  blue: {label: '蓝色', value: '#d9eaff'},
  pink: {label: '粉色', value: '#fce0ee'},
} as const;
export type TextColor = keyof typeof textColors;
export type HighlightColor = keyof typeof highlightColors;
export const escapeWritingHtml = (text: string) => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
export const markdownLabel = (text: string) => text.replace(/[\\`*_[\]<>]/g, '\\$&');
export const markdownDestination = (text: string) => text.replace(/[\s()]/g, character => encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'));

function preset(style: string, property: string, colors: Record<string, {value: string}>) {
  const color = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'i').exec(style)?.[1].trim().toLowerCase();
  return Object.keys(colors).find(key => colors[key].value === color);
}
export function writingStyles(style = '') {
  return {color: preset(style, 'color', textColors) as TextColor | undefined, highlight: preset(style, 'background-color', highlightColors) as HighlightColor | undefined};
}
export function patchWritingStyle(style: string, property: 'color' | 'background-color', value: string) {
  const declarations = style.split(';').filter(part => part.trim() && part.split(':')[0].trim().toLowerCase() !== property);
  if (value) declarations.push(property + ': ' + value);
  return declarations.join('; ');
}
export function inlineCode(text: string) {
  const marker = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const padding = /^`|`$/.test(text) || /^ .* $/s.test(text) && /[^ ]/.test(text) ? ' ' : '';
  return marker + padding + text + padding + marker;
}
