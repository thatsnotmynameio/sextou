import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import * as icons from './Icon';

test('icons has the 17 icons the sidebar uses', () => {
  expect(Object.keys(icons)).toHaveLength(17);
});

test.each(Object.entries(icons))(
  'icons %s is a hidden 16×16 SVG drawn in the text color',
  (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg.childElementCount).toBeGreaterThan(0);
  },
);

test('icons lets the caller set the size and class', () => {
  const { container } = render(
    <icons.ChevronDownIcon width={14} height={14} className="text-muted" />,
  );
  const svg = container.querySelector('svg')!;
  expect(svg).toHaveAttribute('width', '14');
  expect(svg).toHaveClass('text-muted');
});
