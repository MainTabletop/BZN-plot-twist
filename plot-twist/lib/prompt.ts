/**
 * Sanitizes user input for prompt safety:
 * - Replaces triple backticks with a zero-width space between backticks to prevent prompt injection
 * - Escapes HTML tags to prevent HTML injection
 * - Neutralizes template string syntax to prevent variable injection
 * - Limits text to maximum allowed length
 */
export function sanitizePrompt(text: string, maxLen = 1738) {
  if (!text) return '';
  
  return text
    // Replace triple backticks with two backticks and a zero-width space to prevent code block escaping
    .replace(/```/g, '`​`')
    // Escape HTML tags to prevent HTML injection
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Neutralize template string syntax
    .replace(/\${/g, '$\\{')
    .replace(/{{/g, '{ {')
    .replace(/}}/g, '} }')
    // Truncate to maximum length
    .slice(0, maxLen);
} 