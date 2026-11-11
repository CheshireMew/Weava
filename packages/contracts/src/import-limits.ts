export const importFileBytes=128*1024*1024;
export const markdownImportFileBytes=32*1024*1024;
export const isMarkdownImportFile=(name:string)=>/\.(md|markdown)$/i.test(name);
// The wire envelope includes options and JSON escaping around the selected file.
export const importRequestBytes=192*1024*1024;
