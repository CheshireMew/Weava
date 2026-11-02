import { type ReactNode } from 'react';

export function Card({
  title,
  children,
  action,
  className = '',
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={'analytics-card ' + className}>
      <div className="analytics-card-title">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
