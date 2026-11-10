import {siteText} from '@weava/contracts';
/** Touch only the framework-generated code-copy control, never article text. */
export function localizeCodeControls(html:string,language:string){
  if(/^zh(?:-cn|-hans)?$/i.test(language))return html;
  return html.replace(/(<button\b[^>]*\bdata-copy-code[^>]*>)复制代码(<\/button>)/g,(_match,open,close)=>open+siteText(language,'复制代码')+close);
}
