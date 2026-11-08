/** Reserve the content area; fast reads finish before the placeholder appears. */
export function LoadingState({ label = '载入内容', className = '' }: { label?: string; className?: string }) {
  return <div className={'loading-state ' + className} role="status" aria-label={label}>
    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </div>;
}
