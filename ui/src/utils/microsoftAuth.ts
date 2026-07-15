export const consumeMicrosoftAuthError = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const url = new URL(window.location.href);
  const message = url.searchParams.get('auth_error');
  if (!message) {
    return null;
  }
  url.searchParams.delete('auth_error');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return message;
};
