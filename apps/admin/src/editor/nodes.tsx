import { useState } from 'react';
import { useSelectors } from '../Selectors.tsx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, DecoratorNode, type NodeKey } from 'lexical';

export class MediaNode extends DecoratorNode<any> {
  __src: string;
  __alt: string;
  __kind: string;
  __caption: string;
  __href: string = '';
  static getType() {
    return 'image';
  }
  static importDOM(): any {
    return {
      img: (el: HTMLImageElement) => ({
        conversion: () => ({
          node: new MediaNode(
            el.getAttribute('src') ?? el.src,
            el.alt,
            'image',
            undefined,
            el.closest('figure')?.querySelector('figcaption')?.textContent ?? '',
          ),
        }),
        priority: 1,
      }),
      video: (el: HTMLVideoElement) => ({
        conversion: () => ({
          node: new MediaNode(
            el.getAttribute('src') ?? el.src,
            '',
            'video',
            undefined,
            el.closest('figure')?.querySelector('figcaption')?.textContent ?? '',
          ),
        }),
        priority: 1,
      }),
      audio: (el: HTMLAudioElement) => ({
        conversion: () => ({ node: new MediaNode(el.getAttribute('src') ?? el.src, '', 'audio') }),
        priority: 1,
      }),
    };
  }
  static clone(n: MediaNode) {
    const node = new MediaNode(n.__src, n.__alt, n.__kind, n.__key, n.__caption);
    node.__href = n.__href;
    return node;
  }
  constructor(src = '', alt = '', kind = 'image', key?: NodeKey, caption = '') {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__kind = kind;
    this.__caption = caption;
  }
  createDOM() {
    return document.createElement('div');
  }
  isInline() {
    return false;
  }
  updateDOM() {
    return false;
  }
  static importJSON(v: any) {
    const node = new MediaNode(v.src, v.altText, v.kind, undefined, v.caption).updateFromJSON(v);
    node.__href = v.href ?? '';
    return node;
  }
  exportJSON(): any {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      src: this.__src,
      altText: this.__alt,
      kind: this.__kind,
      caption: this.__caption,
      ...(this.__href ? { href: this.__href } : {}),
    };
  }
  decorate() {
    return (
      <MediaElement
        nodeKey={this.getKey()}
        src={this.__src}
        alt={this.__alt}
        kind={this.__kind}
        caption={this.__caption}
      />
    );
  }
  exportDOM(): any {
    const figure = document.createElement('figure');
    if (this.__kind === 'file') {
      const link = document.createElement('a');
      link.href = this.__src;
      link.textContent = this.__alt || '下载附件';
      figure.append(link);
    } else {
      const media = document.createElement(
        this.__kind === 'audio' ? 'audio' : this.__kind === 'video' ? 'video' : 'img',
      );
      media.setAttribute('src', this.__src);
      if (this.__kind === 'image') media.setAttribute('alt', this.__alt);
      else media.setAttribute('controls', '');
      figure.append(media);
    }
    if (this.__href) {
      const link = document.createElement('a');
      link.href = this.__href;
      link.append(...Array.from(figure.childNodes));
      figure.append(link);
    }
    if (this.__caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.__caption;
      figure.append(caption);
    }
    return { element: figure };
  }
}

export class EmbedNode extends DecoratorNode<any> {
  __value: { src: string; title: string; width?: string; height?: string };
  static getType() {
    return 'embed';
  }
  static clone(node: EmbedNode) {
    return new EmbedNode(node.__value, node.__key);
  }
  constructor(value = { src: '', title: '嵌入内容' }, key?: NodeKey) {
    super(key);
    this.__value = value;
  }
  static importJSON(value: any) {
    return new EmbedNode(value).updateFromJSON(value);
  }
  exportJSON(): any {
    return { ...super.exportJSON(), ...this.__value, type: 'embed', version: 1 };
  }
  createDOM() {
    return document.createElement('div');
  }
  updateDOM() {
    return false;
  }
  decorate() {
    return (
      <iframe
        {...this.__value}
        className="editor-embed"
        sandbox="allow-scripts"
        loading="lazy"
        allowFullScreen
      />
    );
  }
  exportDOM() {
    const element = document.createElement('iframe');
    Object.entries(this.__value).forEach(([key, value]) => element.setAttribute(key, value ?? ''));
    return { element };
  }
}

export function MediaElement({
  nodeKey,
  src,
  alt,
  kind,
  caption,
}: {
  nodeKey: string;
  src: string;
  alt: string;
  kind: string;
  caption: string;
}) {
  const [editor] = useLexicalComposerContext(),
    selectors = useSelectors();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({ src, alt, caption, kind });
  return (
    <figure className="editor-media" contentEditable={false}>
      {kind === 'video' ? (
        <video src={src} controls />
      ) : kind === 'audio' ? (
        <audio src={src} controls />
      ) : kind === 'file' ? (
        <a href={src}>{alt || '下载附件'}</a>
      ) : (
        <img src={src} alt={alt} />
      )}
      {caption && <figcaption>{caption}</figcaption>}
      <button
        type="button"
        onClick={() => {
          setDraft({ src, alt, caption, kind });
          setEditing(!editing);
        }}
      >
        编辑媒体
      </button>
      {editing && (
        <div className="media-inline-settings">
          <label>
            地址
            <input
              value={draft.src}
              onChange={(event) => setDraft({ ...draft, src: event.target.value })}
            />
          </label>
          <label>
            图片说明或附件文字
            <input
              value={draft.alt}
              onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
            />
          </label>
          <label>
            图注
            <input
              value={draft.caption}
              onChange={(event) => setDraft({ ...draft, caption: event.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              const media = await selectors.media();
              if (media)
                setDraft({
                  src: media.url,
                  alt: media.alt ?? media.name,
                  caption: media.caption ?? '',
                  kind: media.kind,
                });
            }}
          >
            更换媒体
          </button>
          <button
            type="button"
            onClick={() => {
              editor.update(() => {
                const node = $getNodeByKey(nodeKey);
                if (node instanceof MediaNode) {
                  const writable = node.getWritable();
                  writable.__src = draft.src;
                  writable.__alt = draft.alt;
                  writable.__caption = draft.caption;
                  writable.__kind = draft.kind;
                }
              });
              setEditing(false);
            }}
          >
            保存媒体修改
          </button>
          <button
            type="button"
            onClick={() => editor.update(() => $getNodeByKey(nodeKey)?.remove())}
          >
            移除媒体
          </button>
        </div>
      )}
    </figure>
  );
}
