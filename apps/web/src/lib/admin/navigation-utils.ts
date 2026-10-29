// Simple admin navigation utilities using URL-encoded state

/**
 * Build user detail URL with current page state preserved
 */
export function buildUserDetailUrl(
  userId: string,
  currentSearchParams: string = "",
): string {
  if (!currentSearchParams) {
    return `/admin/users/${userId}`;
  }

  // URL encode the search params to pass as a single parameter
  const encodedParams = encodeURIComponent(currentSearchParams);
  return `/admin/users/${userId}?searchPageParams=${encodedParams}`;
}

/**
 * Build return URL from encoded search params
 */
export function buildReturnUrl(
  baseUrl: string,
  encodedSearchParams: string = "",
): string {
  if (!encodedSearchParams) {
    return baseUrl;
  }

  try {
    const decodedParams = decodeURIComponent(encodedSearchParams);
    return decodedParams ? `${baseUrl}?${decodedParams}` : baseUrl;
  } catch (error) {
    console.error("Error decoding search params:", error);
    return baseUrl;
  }
}
