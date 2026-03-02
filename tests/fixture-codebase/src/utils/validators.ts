export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateNotEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function validateMinLength(value: string, min: number): boolean {
  return value.length >= min;
}

export function createValidator<T>(
  predicate: (value: T) => boolean,
  errorMessage: string
): (value: T) => void {
  return (value: T) => {
    if (!predicate(value)) {
      throw new Error(errorMessage);
    }
  };
}
