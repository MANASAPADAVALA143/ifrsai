import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = 'font-semibold rounded-lg transition-all inline-flex items-center justify-center gap-2';

  const variants = {
    primary: 'bg-accent text-white hover:bg-accent/90 disabled:bg-gray-300',
    secondary: 'bg-white text-primary border-2 border-primary hover:bg-gray-50',
    ghost: 'bg-transparent text-accent border-2 border-accent hover:bg-accent/10',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300',
  };

  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg',
  };

  return (
    <button
      className={cn(
        baseClasses,
        variants[variant],
        sizes[size],
        (disabled || isLoading) && 'cursor-not-allowed opacity-50',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
