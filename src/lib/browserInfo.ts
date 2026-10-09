/** Browser family and major version only: never retain a full user agent. */
export function browserInfo(userAgent: string): string | undefined {
  const browsers: [string, RegExp][] = [
    ['Edge', /(?:Edg|EdgiOS|EdgA)\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari\//],
  ];
  for (const [name, pattern] of browsers) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  return undefined;
}
