declare module 'sax' {
  interface XmlTag { name: string; local: string; uri: string; attributes: Record<string, { local: string; value: string }> }
  interface XmlParser {
    onopentag?: (tag: XmlTag) => void; onclosetag?: (name: string) => void;
    ontext?: (text: string) => void; oncdata?: (text: string) => void;
    onerror?: (error: Error) => void; ondoctype?: (doctype: string) => void;
    write: (text: string) => XmlParser; close: () => XmlParser;
  }
  const sax: { parser: (strict: boolean, options?: Record<string, unknown>) => XmlParser };
  export default sax;
}
