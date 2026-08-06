/**
 * Turns an Axios error into something worth showing a user.
 *
 * The API answers in three different shapes and only one of them is ours:
 *
 *  - `{ error }`            our own controllers
 *  - `{ errors: {...} }`    ASP.NET model-validation failures (RFC 9110
 *                           ProblemDetails), keyed by field path
 *  - `{ title, detail }`    other ProblemDetails responses
 *
 * Reading only `data.error` — which most call sites used to do — silently
 * discarded validation messages and left the user with a generic failure,
 * turning a one-line fix into a debugging session.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as any)?.response?.data;

  if (!data) return (err as any)?.message || fallback;
  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data.error === 'string') return data.error;

  // Validation: surface the first field error, prefixed with the field name so
  // "Persons[0].Emails" is traceable rather than a bare "field is required".
  if (data.errors && typeof data.errors === 'object') {
    const [field, messages] = Object.entries(data.errors as Record<string, string[]>)[0] ?? [];
    if (Array.isArray(messages) && messages[0]) {
      const clean = field?.replace(/^Extraction\./, '');
      return clean ? `${clean}: ${messages[0]}` : messages[0];
    }
  }

  if (typeof data.detail === 'string') return data.detail;
  if (typeof data.title === 'string') return data.title;

  return fallback;
}
