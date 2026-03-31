let _memoryToken: string | null = null;

export function setMemoryToken(token: string | null): void {
  _memoryToken = token;
}

export function getMemoryToken(): string | null {
  return _memoryToken;
}
