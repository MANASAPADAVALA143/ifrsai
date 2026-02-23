// Format numbers in Indian number system (₹1,24,53,200)
export function formatIndianCurrency(amount: number): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}

// Format with decimals
export function formatIndianCurrencyWithDecimals(amount: number, decimals: number = 2): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return formatter.format(amount);
}

// Format number without currency symbol
export function formatIndianNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

// Format crores
export function formatCrores(amount: number): string {
  const crores = amount / 10000000;
  return `₹${crores.toFixed(2)}Cr`;
}

// Format lakhs
export function formatLakhs(amount: number): string {
  const lakhs = amount / 100000;
  return `₹${lakhs.toFixed(2)}L`;
}

// Class name utility (like clsx)
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// Format date
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get greeting based on time
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
