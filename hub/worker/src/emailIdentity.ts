// Correos: un solo sitio donde se normalizan y validan, porque son la clave de
// `Directory` (correo -> inquilino) y una diferencia de mayúsculas sería otra persona.

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
