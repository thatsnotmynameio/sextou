import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} data-variant={variant} {...props} />;
}
