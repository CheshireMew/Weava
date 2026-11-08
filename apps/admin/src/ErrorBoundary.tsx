import {Component,createElement,lazy as createLazy,type ComponentType,type ComponentProps,type ReactNode} from 'react';

const failedImports=new Set<()=>void>();
/** A rejected React.lazy promise must be replaced before a local retry can work. */
export function retryableLazy<T extends ComponentType<any>>(load:()=>Promise<{default:T}>):ComponentType<ComponentProps<T>>{
  const attempt=()=>load().catch(error=>{failedImports.add(reset);throw error;});
  let current=createLazy(attempt);
  const reset=()=>{current=createLazy(attempt);};
  return props=>createElement(current as ComponentType<any>,props);
}
export function retryLazyImports(){const retry=[...failedImports];failedImports.clear();retry.forEach(reset=>reset());}

interface Props {children:ReactNode;resetKey?:string;onRetry?:()=>void|Promise<void>;onReload?:()=>void|Promise<void>}
export class ErrorBoundary extends Component<Props,{error:Error|null;pending:boolean;message:string}>{
  state={error:null as Error|null,pending:false,message:''};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidUpdate(previous:Props){if(previous.resetKey!==this.props.resetKey&&this.state.error)this.setState({error:null,message:''});}
  private retry=async()=>{
    this.setState({pending:true,message:''});
    try{await this.props.onRetry?.();retryLazyImports();this.setState({error:null});}
    catch(error:any){this.setState({message:error.message});}
    finally{this.setState({pending:false});}
  };
  private reload=async()=>{
    this.setState({pending:true,message:''});
    try{if(this.props.onReload)await this.props.onReload();else window.location.reload();}
    catch(error:any){this.setState({message:'无法保留修改，请保持页面打开：'+error.message});}
    finally{this.setState({pending:false});}
  };
  render(){
    if(!this.state.error)return this.props.children;
    return <div className="panel-state" role="alert"><p>这个页面暂时无法打开。</p>{this.state.message&&<p>{this.state.message}</p>}<div className="inline"><button disabled={this.state.pending} onClick={()=>void this.retry()}>重试</button><button disabled={this.state.pending} onClick={()=>void this.reload()}>重新载入后台</button></div></div>;
  }
}
