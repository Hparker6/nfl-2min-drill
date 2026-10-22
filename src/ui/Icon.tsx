/** Drawn icons for the few places that used text symbols (★, ↺): one stroke and weight, sized by the text around them. */
export function Icon({ name, size = '1em', title }: { name: 'star' | 'replay'; size?: string | number; title?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': title ? undefined : true, role: title ? 'img' : undefined, className: `icon-${name}`, style: { verticalAlign: '-0.125em', flex: 'none' } } as const;
  if (name === 'star') {
    return <svg {...common}>{title && <title>{title}</title>}<path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" /></svg>;
  }
  return <svg {...common}>{title && <title>{title}</title>}<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
